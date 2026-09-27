import test from 'node:test';
import assert from 'node:assert/strict';
import * as capture from '../src/rng/safari-capture-plan.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';
const pokemon={validity:'valid',species:113,personality:123,otId:456,ivs:{hp:1},shiny:true};
const fingerprint=encounterFingerprint(pokemon);
const source={stateSha256:'state',sramSha256:'save'};
const observation=(owned=[],inBattle=false)=>({phase:'stable',sram:{sha256:'save'},emulator:{inBattle},playerMemory:{battleOutcome:6,encounter:inBattle?{validity:'valid',pokemon}:null,trainer:{partyValidity:'valid',party:[],storage:{validity:'valid',pokemon:owned}}}});
test('a Safari retry requires proof the protected individual was never captured or saved',()=>{
 const evidence={fingerprint,caught:false,nativeSaveVerified:false};
 assert.equal(capture.canRetrySafariCapture({observation:observation(),evidence,source}),true);
 for(const change of [{observation:observation([pokemon])},{evidence:{...evidence,caught:true}},{evidence:{...evidence,postCatch:true}},{observation:{...observation(),sram:{sha256:'changed'}}},{observation:{...observation(),playerMemory:{trainer:{partyValidity:'unknown'}}}}])
  assert.equal(capture.canRetrySafariCapture({observation:observation(),evidence,source,...change}),false);
});
test('capture replay rejects stale sources, unsafe inputs and changed Pokémon before acting',async()=>{
 const plan={schema:'pokemon-suite/safari-capture-plan/v1',verified:true,verifiedRepeats:2,source,fingerprint,steps:[{frames:1,buttons:['a']}]};
 let inputs=0;
 const args={plan,source,observe:()=>observation([],true),execute:async()=>inputs++};
 await assert.rejects(capture.executeSafariCapturePlan({...args,source:{...source,stateSha256:'stale'}}));
 await assert.rejects(capture.executeSafariCapturePlan({...args,plan:{...plan,steps:[{frames:1,buttons:['start']}]}}));
 await assert.rejects(capture.executeSafariCapturePlan({...args,observe:()=>observation()}));
 assert.equal(inputs,0);
 let o=observation([],true);
 const result=await capture.executeSafariCapturePlan({...args,observe:()=>o,execute:async()=>{inputs++;o=observation([pokemon]);}});
 assert.equal(result.status,'caught');assert.equal(inputs,1);
});
