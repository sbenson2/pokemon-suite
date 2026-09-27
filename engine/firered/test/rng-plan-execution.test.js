import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../src/rng/wild-search.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('verified land approach can replay the normal B plus direction running input',async()=>{
 const source={stateSha256:'same',sramSha256:'same'},steps=[{frames:4,buttons:['b','right']}];
 let executed;
 const result=await mod.executeRngPlan({plan:{schema:'pokemon-suite/rng-input-plan/v1',verified:true,source,steps},source,observe:()=>({}),execute:async a=>executed=a});
 assert.deepEqual(executed,{buttons:['b','right'],holdFrames:4,releaseFrames:0});assert.equal(result.status,'prediction-mismatch');
 await assert.rejects(mod.executeRngPlan({plan:{schema:'pokemon-suite/rng-input-plan/v1',verified:true,source,steps:[{frames:1,buttons:['a','start']}]},source,observe:()=>({}),execute:async()=>{throw new Error('must not execute');}}),/Invalid RNG input/);
});
test('ordinary hunts stop on the verified target identity without requiring a shiny',async()=>{
 const source={stateSha256:'same',sramSha256:'same'},pokemon={validity:'valid',personality:123,species:32,otId:42,shiny:false};
 const plan={schema:'pokemon-suite/rng-input-plan/v1',verified:true,shinyRequired:false,source,steps:[{frames:1,buttons:[]},{frames:1,buttons:['a']}],pokemon};
 let count=0;
 const result=await mod.executeRngPlan({plan,source,observe:()=>({playerMemory:{encounter:count?{validity:'valid',pokemon}:null}}),execute:async()=>count++});
 assert.equal(result.status,'protected-target');assert.equal(count,1);assert.equal(result.matched,true);
});
test('verified RNG input plans reject stale sources before pressing anything',async()=>{
 assert.equal(typeof mod.executeRngPlan,'function');let inputs=0;
 await assert.rejects(mod.executeRngPlan({plan:{schema:'pokemon-suite/rng-input-plan/v1',verified:true,source:{stateSha256:'old'},steps:[{frames:1,buttons:['a']}]},source:{stateSha256:'new'},observe:()=>({}),execute:()=>inputs++}),/source/);
 assert.equal(inputs,0);
});
test('RNG replay stops for any shiny before subsequent input and reports prediction mismatch honestly',async()=>{
 assert.equal(typeof mod.executeRngPlan,'function');let frame=0;
 const source={stateSha256:'same',sramSha256:'same'};
 const plan={schema:'pokemon-suite/rng-input-plan/v1',verified:true,source,steps:[{frames:1,buttons:[]},{frames:1,buttons:['a']}],pokemon:{personality:123,species:113}};
 const observe=()=>({frame,emulator:{inBattle:frame>0},playerMemory:{encounter:frame>0?{validity:'valid',pokemon:{validity:'valid',species:102,personality:456,shiny:true}}:null}});
 const result=await mod.executeRngPlan({plan,source,observe,execute:async a=>{frame+=a.holdFrames;}});
 assert.equal(frame,1);assert.equal(result.status,'protected-shiny');assert.equal(result.matched,false);
});
