import test from 'node:test';
import assert from 'node:assert/strict';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';
const mod=await import('../src/rng/protected-capture-plan.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const pokemon={validity:'valid',species:17,personality:3989795555,otId:2161188857,shiny:true,moves:[18],pp:[20],ivs:{hp:0,attack:27,defense:17,speed:25,spAttack:17,spDefense:3}};
const fingerprint=encounterFingerprint(pokemon),source={stateSha256:'state',sramSha256:'save'};
const observation=(mons=[],inBattle=false)=>({phase:'stable',sram:{sha256:'save'},emulator:{inBattle,mode:inBattle?'battle':'overworld'},playerMemory:{battleOutcome:5,battleTypeFlags:4,encounter:inBattle?{validity:'valid',pokemon}:null,trainer:{partyValidity:'valid',party:[],storage:{validity:'valid',pokemon:mons}}}});
test('scripted legendary singles use the same verified capture fallback without allowing trainer, link or Safari battles',async()=>{
 const evidence={pokemon,fingerprint,caught:false,nativeSaveVerified:false};
 for(const flags of [4,1028,8196,270340,139268]){
  let o=observation([],true);o.playerMemory.battleTypeFlags=flags;o.playerMemory.trainer.bag={pokeBalls:[{itemId:2,quantity:99}]};
  assert.equal(mod.canQualifyPostgameCapture(o,evidence,'capture-battler-survival-unknown'),true,String(flags));
  const plan={schema:'pokemon-suite/protected-capture-plan/v1',verified:true,verifiedRepeats:2,source,fingerprint,steps:[{frames:1,buttons:['a']}]};
  assert.equal((await mod.executeProtectedCapturePlan({plan,source,observe:()=>o,execute:async()=>{o=observation([pokemon]);}})).status,'caught');
 }
 for(const flags of [0,1,12,132,68,6]){
  const o=observation([],true);o.playerMemory.battleTypeFlags=flags;o.playerMemory.trainer.bag={pokeBalls:[{itemId:2,quantity:99}]};
  assert.equal(mod.canQualifyPostgameCapture(o,evidence,'capture-battler-survival-unknown'),false,String(flags));
 }
});
test('retaliation moves and Shadow Tag qualify a shiny capture before any weakening or switching',()=>{
 for(const effect of ['EFFECT_COUNTER','EFFECT_MIRROR_COAT','EFFECT_DESTINY_BOND']){
  const o=observation([],true),rules={moves:[{id:18,effect}]};
  assert.equal(mod.requiresTimedCapture(o,rules),true,effect);
  o.playerMemory.encounter.pokemon={...pokemon,pp:[0],moves:[18,33]};
  assert.equal(mod.requiresTimedCapture(o,{moves:[{id:18,effect},{id:33,effect:'EFFECT_HIT'}]}),false,'exhausted retaliation move is not an active threat');
 }
 const o=observation([],true),rules={moves:[{id:18,effect:'EFFECT_HIT'}]};
 o.playerMemory.battle={opponent:{ability:23}};
 assert.equal(mod.requiresTimedCapture(o,rules),true,'Shadow Tag applies independently of species');
 o.playerMemory.encounter.pokemon={...pokemon,shiny:false};
 assert.equal(mod.requiresTimedCapture(o,rules),false,'ordinary encounters retain their own policy');
});
test('a fainted catcher triggers verified replacement and capture for the same shiny',()=>{
 const o=observation([],true);o.playerMemory.battle={player:{hp:0}};
 assert.equal(mod.requiresTimedCapture(o,{moves:[{id:18,effect:'EFFECT_HIT'}]}),true);
});
test('risky capture planning covers forced escape, self-KO and recoil, across species',()=>{
 assert.equal(typeof mod.requiresTimedCapture,'function');
 for(const effect of ['EFFECT_ROAR','EFFECT_TELEPORT','EFFECT_EXPLOSION','EFFECT_MEMENTO','EFFECT_RECOIL','EFFECT_PERISH_SONG'])assert.equal(mod.requiresTimedCapture(observation([],true),{moves:[{id:18,effect}]}),true,effect);
 assert.equal(mod.requiresTimedCapture(observation([],true),{moves:[{id:18,effect:'EFFECT_HIT'}]}),false);
 assert.equal(mod.requiresTimedCapture({...observation([],true),playerMemory:{...observation([],true).playerMemory,battleTypeFlags:12}},{moves:[{id:18,effect:'EFFECT_ROAR'}]}),false);
});
test('retry requires a confirmed failed battle, unchanged native save and exact unowned shiny identity',()=>{
 assert.equal(typeof mod.canRetryProtectedCapture,'function');
 const evidence={pokemon,fingerprint,caught:false,nativeSaveVerified:false};
 const args={observation:observation(),evidence,source};assert.equal(mod.canRetryProtectedCapture(args),true);
 for(const change of [{observation:observation([pokemon])},{evidence:{...evidence,caught:true}},{evidence:{...evidence,postCatch:{}}},{evidence:{...evidence,fingerprint:'wrong'}},{observation:{...observation(),sram:{sha256:'different'}}},{observation:{...observation(),playerMemory:{...observation().playerMemory,battleOutcome:7}}},{observation:{...observation(),playerMemory:{trainer:{partyValidity:'unknown'}}}}])assert.equal(mod.canRetryProtectedCapture({...args,...change}),false);
});
test('protected replay validates the source, identity and every step before sending input',async()=>{
 assert.equal(typeof mod.executeProtectedCapturePlan,'function');
 const plan={schema:'pokemon-suite/protected-capture-plan/v1',verified:true,verifiedRepeats:2,source,fingerprint,steps:[{frames:1,buttons:['a']}]};let calls=0,o=observation([],true);
 const args={plan,source,observe:()=>o,execute:async()=>{calls++;o=observation([pokemon]);}};
 for(const change of [{source:{...source,stateSha256:'changed'}},{plan:{...plan,steps:[{frames:NaN,buttons:['a']}]}},{plan:{...plan,steps:[{frames:1,buttons:['start']}]}},{plan:{...plan,verifiedRepeats:1}},{observe:()=>observation([pokemon],true)}])await assert.rejects(mod.executeProtectedCapturePlan({...args,...change}));
 assert.equal(calls,0);assert.equal((await mod.executeProtectedCapturePlan(args)).status,'caught');assert.equal(calls,1);
});
test('Stop cancels a planned capture without further inputs',async()=>{
 assert.equal(typeof mod.executeProtectedCapturePlan,'function');let calls=0;
 const plan={schema:'pokemon-suite/protected-capture-plan/v1',verified:true,verifiedRepeats:2,source,fingerprint,steps:[{frames:1,buttons:['a']}]};
 const r=await mod.executeProtectedCapturePlan({plan,source,observe:()=>observation([],true),execute:async()=>calls++,signal:{aborted:true}});assert.equal(r.status,'cancelled');assert.equal(calls,0);
});
test('residual damage and exhausted PP also require a verified capture before the next turn',()=>{
 const base=observation([],true),mechanics={moves:[{id:18,effect:'EFFECT_HIT'}]};
 for(const opponent of [{status1:8},{status2:1},{status3:4}])assert.equal(mod.requiresTimedCapture({...base,playerMemory:{...base.playerMemory,battle:{opponent}}},mechanics),true);
 assert.equal(mod.requiresTimedCapture({...base,playerMemory:{...base.playerMemory,battle:{weather:128}}},mechanics),true);
 assert.equal(mod.requiresTimedCapture({...base,playerMemory:{...base.playerMemory,encounter:{validity:'valid',pokemon:{...pokemon,pp:[0]}}}},mechanics),true);
});
test('the last few balls trigger qualification and depletion can retry only the same uncaught battle',()=>{
 const o=observation([],true);o.playerMemory.trainer.bag={pokeBalls:[{itemId:4,quantity:3}]};
 assert.equal(mod.requiresTimedCapture(o,{moves:[{id:18,effect:'EFFECT_HIT'}]}),true);
 o.playerMemory.trainer.bag.pokeBalls=[];
 const evidence={pokemon,fingerprint,caught:false,nativeSaveVerified:false};
 assert.equal(mod.canRetryDepletedCapture({observation:o,evidence,source}),true);
 for(const patch of [{evidence:{...evidence,caught:true}},{source:{...source,sramSha256:'changed'}},{observation:observation([pokemon],true)},{observation:{...o,playerMemory:{...o.playerMemory,trainer:{...o.playerMemory.trainer,bag:{pokeBalls:[{itemId:4,quantity:1}]}}}}}])assert.equal(mod.canRetryDepletedCapture({observation:o,evidence,source,...patch}),false);
});

// Model native menu/input boundaries, not planner recommendations. A missed
// throw returns to the command menu; only a fresh button press selects an item.
function captureLab({catchOn=2,quantity=5,flags=4,flee=false,wrongIdentity=false}={}){
 let state={stage:'context',quantity,throws:0,held:false,ended:false,caught:false};
 let closed=false;
 const capture=()=>{
  const o=observation(state.caught?[pokemon]:[],!state.ended),m=o.playerMemory;
  m.battleTypeFlags=flags;m.battle={player:{hp:100}};
  if(wrongIdentity&&state.throws)m.encounter={validity:'valid',pokemon:{...pokemon,personality:1}};
  m.trainer.bag={pokeBalls:[{itemId:2,quantity:state.quantity}]};
  m.ui=state.stage==='action'?{battle:{stage:'action',cursor:1}}:state.stage==='message'?{battle:{stage:'message'}}:{bag:{stage:state.stage,pocket:2,selectedItemId:2,index:0,contextCursor:0}};
  return o;
 };
 const session={
  step(buttons){const pressed=buttons.includes('a')&&!state.held;state.held=buttons.includes('a');if(!pressed||state.ended)return;
   if(state.stage==='context'){state.quantity--;state.throws++;state.caught=state.throws===catchOn;state.ended=state.caught||flee;state.stage='message';}
   else if(state.stage==='message')state.stage='action';
   else if(state.stage==='action')state.stage='list';
   else if(state.stage==='list')state.stage='context';
  },
  saveState:()=>structuredClone(state),saveSram:()=>null,loadSram(){},
  loadState(s){state=structuredClone(s);},close(){closed=true;}
 };
 return {commit:source,session,capture,observer:{resetHistory(){}},get throws(){return state.throws;},get closed(){return closed;}};
}
test('capture qualification proves a bounded multi-ball trace and independently replays it from the original source',async()=>{
 const labs=[];
 const plan=await mod.buildProtectedCapturePlan({source,maxDelays:1,openTrial:async()=>{const lab=captureLab();labs.push(lab);return lab;}});
 assert.equal(plan.verifiedRepeats,2);assert.equal(plan.throws,2);
 assert.equal(labs.length,2);assert.ok(labs.every(l=>l.throws===2&&l.closed));
});
test('qualification preserves throw, stock and roamer limits when a capture cannot finish',async()=>{
 for(const [options,limit] of [[{catchOn:4},3],[{catchOn:2,quantity:1},1],[{catchOn:2,flags:1028},1],[{catchOn:2,flee:true},1]]){
  const lab=captureLab(options);
  await assert.rejects(mod.buildProtectedCapturePlan({source,maxDelays:1,openTrial:async()=>lab}),/No .*timing passed qualification/);
  assert.equal(lab.throws,limit);assert.equal(lab.closed,true);
 }
});
test('qualification rejects changed encounter identity and a nonreproducing second trial',async()=>{
 const lab=captureLab({wrongIdentity:true});
 await assert.rejects(mod.buildProtectedCapturePlan({source,maxDelays:1,openTrial:async()=>lab}),/encounter changed/i);
 assert.equal(lab.closed,true);
 const labs=[];
 await assert.rejects(mod.buildProtectedCapturePlan({source,maxDelays:1,openTrial:async()=>{const l=captureLab({catchOn:labs.length?99:2});labs.push(l);return l;}}),/independent replay/);
 assert.ok(labs.every(l=>l.closed));
});
test('cancelling qualification closes its isolated session before sending another input',async()=>{
 const lab=captureLab();
 await assert.rejects(mod.buildProtectedCapturePlan({source,maxDelays:1,signal:{aborted:true},openTrial:async()=>lab}),/cancelled/);
 assert.equal(lab.throws,0);assert.equal(lab.closed,true);
});
