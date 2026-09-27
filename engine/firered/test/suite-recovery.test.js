import test from 'node:test';
import assert from 'node:assert/strict';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';
import {canContinuePostgame} from '../src/suite/postgame.js';
const mod=await import('../src/suite/recovery.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const pokemon={validity:'valid',species:17,personality:7,otId:8,shiny:true,ivs:{hp:1}},evidence={pokemon,fingerprint:encounterFingerprint(pokemon)},anchor={stateSha256:'state',sramSha256:'save'};
const args=()=>({enabled:true,running:false,mission:{id:'hunt-1',status:'blocked',reason:'protected-encounter-lost-or-unverified',method:'wild-land',protected:true,protectedAnchor:anchor},evidence,wireless:{remotePlayers:0},observation:{phase:'stable',sram:{sha256:'save'},emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:'FOREST'},battleOutcome:5,trainer:{partyValidity:'valid',party:[],storage:{validity:'valid',pokemon:[]}},ui:{}}}});
test('automatic recovery classifies a confirmed lost shiny without replacing the hunt',()=>{
 assert.equal(typeof mod.assessRecovery,'function');const r=mod.assessRecovery(args());assert.equal(r.action,'retry-capture');assert.equal(r.huntId,'hunt-1');
 for(const extra of [{enabled:false},{running:true},{manual:true},{localBusy:true},{wireless:{remotePlayers:1}},{nativeTrade:{phase:'saved-exit-incomplete'}},{mission:{...args().mission,status:'paused'}},{evidence:{...evidence,caught:true}}])assert.equal(mod.assessRecovery({...args(),...extra}).action,'none');
});
test('menu recovery requires a known safe stopped workflow and keeps unsaved capture evidence',()=>{
 const a=args();a.mission={...a.mission,status:'complete'};a.postgame={status:'waiting',reason:'repeated-menu-transaction',objective:{id:'postgame-save'},player:{encounterSafety:{capture:{nativeSaveVerified:false}}}};a.observation.emulator.mode='start-menu';
 assert.equal(mod.assessRecovery(a).action,'resume-postgame');
 a.observation.playerMemory.ui.saveDialog={stage:'writing'};assert.equal(mod.assessRecovery(a).action,'none');
 a.postgame.reason='checksum-mismatch';delete a.observation.playerMemory.ui.saveDialog;assert.equal(mod.assessRecovery(a).action,'none');
});
test('recovery budgets persist across restart and successful progress starts a different incident',()=>{
 assert.equal(typeof mod.createRecoveryLedger,'function');let now=100000;let ledger=mod.createRecoveryLedger();const candidate=mod.assessRecovery(args());
 for(let i=0;i<3;i++){
  const result=ledger.begin(candidate,now);assert.equal(result.allowed,true);assert.equal(result.attempt,i+1);
  assert.equal(ledger.begin(candidate,now+1).allowed,false,'cooldown');
  ledger=mod.createRecoveryLedger(JSON.parse(JSON.stringify(ledger.state())));now+=60000;
 }
 assert.equal(ledger.begin(candidate,now).reason,'attempt-limit');
 assert.equal(ledger.begin(mod.assessRecovery({...args(),mission:{...args().mission,id:'hunt-2'}}),now).allowed,true);
});
test('blocked missions are not presented as ready and manual Stop stays stopped',()=>{
 assert.equal(typeof mod.botHealth,'function');assert.equal(mod.botHealth({enabled:true,running:false,mission:args().mission}).status,'blocked');
 assert.equal(mod.botHealth({enabled:true,running:false,postgame:{status:'waiting',reason:'menu'}}).reason,'menu');
 assert.equal(mod.botHealth({enabled:false,running:false,mission:args().mission}).status,'stopped');
 assert.equal(mod.botHealth({enabled:true,running:true,recovery:{status:'recovering'}}).status,'recovering');
});
test('an interrupted recovery consumes the same durable incident budget and retains capture evidence',()=>{
 const a=args(),prior=mod.assessRecovery(a);a.mission.status='paused';
 a.interruptedRecovery={...prior,status:'recovering',attempt:1};
 assert.equal(mod.assessRecovery(a).action,'retry-capture');
 a.observation.playerMemory.battleOutcome=7;a.observation.playerMemory.trainer.storage.pokemon=[pokemon];
 assert.equal(mod.assessRecovery(a).action,'resume-mission','finish the existing catch without rewinding it');
 assert.equal(mod.assessRecovery(a).key,prior.key);
 const state={encounterSafety:{capture:{pokemon,nativeSaveVerified:false}},transactionRecovery:{blocked:true},movementRecovery:{attempts:3},other:42};
 const clean=mod.replanAfterRecovery(state);assert.deepEqual(clean.encounterSafety,state.encounterSafety);assert.equal(clean.transactionRecovery,null);assert.equal(clean.other,42);assert.ok(state.transactionRecovery);
 assert.equal(mod.assessRecovery({...a,enabled:false}).action,'none');
});
test('normal postgame startup cannot bypass an interrupted or exhausted recovery budget',()=>{
 const a={enabled:true,running:false,mission:{id:'hunt-1',status:'complete'},wireless:{remotePlayers:0},postgame:{status:'running'}};
 for(const status of ['recovering','needs-review'])assert.equal(canContinuePostgame({...a,recovery:{huntId:'hunt-1',status}}),false);
 assert.equal(canContinuePostgame({...a,recovery:{huntId:'previous-hunt',status:'needs-review'}}),true);
 assert.equal(canContinuePostgame({...a,recovery:{huntId:'hunt-1',status:'recovered'}}),true);
});
test('navigation retries share one incident budget across both ends of a loop',()=>{
 const a=args();a.mission={...a.mission,protected:false,reason:'repeated-navigation-cycle',navigationCycle:{objective:'buy-balls',pattern:['TOWN','PORT']}};
 const first=mod.assessRecovery(a);assert.equal(first.action,'resume-mission');
 a.observation.playerMemory.map.id='PORT';assert.equal(mod.assessRecovery(a).key,first.key);
 a.mission.protected=true;assert.equal(mod.assessRecovery(a).action,'none');
 a.mission.protected=false;a.nativeTrade={phase:'trading'};assert.equal(mod.assessRecovery(a).action,'none');
});
test('empty-ball recovery cannot abandon or substitute the protected battle',()=>{
 const a=args();a.mission.reason='capture-balls-exhausted';a.observation.emulator={mode:'battle',inBattle:true};a.observation.playerMemory.battleTypeFlags=4;a.observation.playerMemory.encounter={validity:'valid',pokemon};a.observation.playerMemory.trainer.bag={pokeBalls:[]};
 assert.equal(mod.assessRecovery(a).action,'retry-capture');
 a.observation.playerMemory.encounter.pokemon={...pokemon,personality:999};assert.equal(mod.assessRecovery(a).action,'none');
});
test('a trapped postgame catch can qualify safe timing without discarding its identity',()=>{
 const a=args(),p={...pokemon,shiny:false,species:202},capture={pokemon:p,fingerprint:encounterFingerprint(p),caught:false};
 a.mission.status='complete';a.postgame={status:'waiting',reason:'capture-battler-survival-unknown',player:{encounterSafety:{capture}}};
 a.observation.emulator={mode:'battle',inBattle:true};a.observation.playerMemory.battleTypeFlags=4;a.observation.playerMemory.encounter={validity:'valid',pokemon:p};a.observation.playerMemory.trainer.bag={pokeBalls:[{itemId:9,quantity:8}]};
 assert.equal(mod.assessRecovery(a).action,'resume-postgame');
 a.postgame.player.encounterSafety.capture={...capture,caught:true};assert.equal(mod.assessRecovery(a).action,'none');
});

test('a requested hunt retry records the intervention and retains encounter evidence',()=>{
 const state={workflow:{kind:'party'},transactionRecovery:{blocked:{reason:'repeated-menu-transaction'}},encounterSafety:{encounters:7},other:42};
 const qualification={interventions:[]},runtimeLock={packages:[{digest:'verified-engine'}]};
 const clean=mod.replanAfterRecovery(state,{explicitRetry:true,mission:{protected:false},qualification,runtimeLock,plannerLock:null,observation:args().observation});
 assert.equal(clean.transactionRecovery,null);assert.equal(clean.workflow,null);
 assert.deepEqual(clean.encounterSafety,state.encounterSafety);assert.equal(clean.other,42);
 assert.equal(qualification.interventions.length,1);assert.equal(qualification.interventions[0].type,'policy-retry');
 assert.deepEqual(qualification.interventions[0].runtimeLock,runtimeLock);assert.ok(state.transactionRecovery);
});

test('requested hunt retry cannot clear capture, native save, trade or unclassified stops',()=>{
 const state={transactionRecovery:{blocked:{reason:'repeated-menu-transaction'}}};
 const options={explicitRetry:true,mission:{protected:false},qualification:{interventions:[]},observation:args().observation};
 for(const [s,o] of [
  [state,{...options,explicitRetry:false}],
  [state,{...options,mission:{protected:true}}],
  [{...state,encounterSafety:{capture:{nativeSaveVerified:false}}},options],
  [{...state,workflow:{kind:'in-game-trade'}},options],
  [{...state,transactionRecovery:{blocked:{reason:'save-failed'}}},options],
  [state,{...options,observation:{...options.observation,playerMemory:{...options.observation.playerMemory,ui:{saveDialog:{stage:'writing'}}}}}],
 ])assert.deepEqual(mod.replanAfterRecovery(s,o),s);
 assert.equal(options.qualification.interventions.length,0);
});

test('an active process exposes postgame recovery and blocked reasons instead of healthy running',()=>{
 const health={task:'prize',target:{map:'MAP_ROUTE15',x:47,y:7},lastProgressAt:1000,attempts:2};
 const h=mod.botHealth({enabled:true,running:true,postgame:{status:'recovering',reason:'Rechecking the blocked route.',health}});
 assert.equal(h.status,'recovering');assert.equal(h.reason,'Rechecking the blocked route.');assert.deepEqual(h.progress,health);
 assert.equal(mod.botHealth({enabled:true,running:true,postgame:{status:'waiting',reason:'Save did not verify.'}}).status,'blocked');
});
