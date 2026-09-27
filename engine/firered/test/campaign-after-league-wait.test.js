import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as continuation from '../src/suite/campaign-continuation.js';

// session-worker runCampaign, at the verified Hall of Fame, used
// `if(!continueCompletedCampaign())` on an async function: a pending promise is
// always truthy, so afterCampaign 'wait' never switched the owner to awaiting
// commands. The owner below mirrors the worker's continueCompletedCampaign and
// its bot policy writes.
const completed=()=>({status:'complete',completion:{playablePostgame:true,sramSha256:'a'.repeat(64),nativeHallOfFame:{nativeSaveVerified:true,savedSramSha256:'a'.repeat(64)}}});
function owner(afterCampaign,{fail=null}={}){
 const record={id:'run-example',settings:{afterCampaign},commitment:'unchanged'},state=completed();
 const o={policy:{enabled:true,awaitingCommand:false,consolePowered:true,mode:'campaign',runScope:'campaign'},writes:[],events:[],reports:[]};
 o.handoff=async()=>{
  if(o.policy.runScope!=='campaign')return false;
  const receipt=continuation.campaignPostgameHandoff({record,state,policy:o.policy});
  if(!receipt)return false;
  await new Promise(done=>setTimeout(done,5));// the postgame client's beginAdventure
  if(fail)throw fail;
  o.events.push(['postgame',receipt.campaignId]);
  o.policy={...o.policy,enabled:true,awaitingCommand:false,mode:'postgame',runScope:'postgame'};o.writes.push(o.policy);return true;
 };
 o.hooks={handoff:()=>o.handoff(),report:error=>o.reports.push(error.message),
  awaitCommands:()=>{o.policy={...o.policy,awaitingCommand:true,runScope:'task'};o.writes.push(o.policy);}};
 return o;
}

test("afterCampaign 'wait' leaves the owner awaiting commands after the League",async()=>{
 assert.equal(typeof continuation.settleCompletedCampaign,'function');
 const o=owner('wait');
 assert.equal(await continuation.settleCompletedCampaign(o.hooks),'await-command');
 assert.deepEqual(o.policy,{enabled:true,awaitingCommand:true,consolePowered:true,mode:'campaign',runScope:'task'});
 assert.deepEqual(o.writes,[o.policy],'the waiting policy is written once');
 assert.deepEqual(o.events,[],'no postgame handoff');
 // The worker's idle loop retries the handoff; a waiting owner stays waiting.
 assert.equal(await o.handoff(),false);assert.equal(o.policy.awaitingCommand,true);
});

test("afterCampaign 'postgame' still continues into the postgame, and is awaited before the owner moves on",async()=>{
 assert.equal(typeof continuation.settleCompletedCampaign,'function');
 const o=owner('postgame');
 const settled=continuation.settleCompletedCampaign(o.hooks);
 assert.deepEqual(o.events,[],'the handoff is still in flight');
 assert.equal(await settled,'postgame');
 assert.deepEqual(o.events,[['postgame','run-example']]);
 assert.deepEqual(o.policy,{enabled:true,awaitingCommand:false,consolePowered:true,mode:'postgame',runScope:'postgame'});
 assert.equal(o.writes.length,1,'awaitCommands is never called');
});

test('a failed postgame handoff is reported for the idle retry, not taken as a wait',async()=>{
 assert.equal(typeof continuation.settleCompletedCampaign,'function');
 const o=owner('postgame',{fail:Error('The postgame client did not start.')});
 assert.equal(await continuation.settleCompletedCampaign(o.hooks),'retry');
 assert.deepEqual(o.reports,['The postgame client did not start.']);
 assert.equal(o.policy.runScope,'campaign','the completed campaign keeps its scope, so the idle handoff retries it');
 assert.equal(o.policy.awaitingCommand,false);assert.deepEqual(o.writes,[]);
});

test('session-worker awaits the Hall of Fame settlement instead of testing a promise',()=>{
 const source=readFileSync(new URL('../src/suite/session-worker.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/if\(!continueCompletedCampaign\(\)\)/,'a pending promise is always truthy');
 const branch=source.slice(source.indexOf("decision.kind==='campaign-complete'"),source.indexOf("decision.kind==='blocked'",source.indexOf("decision.kind==='campaign-complete'")));
 assert.match(branch,/await settleCompletedCampaign\(\{handoff:continueCompletedCampaign,/);
 assert.match(branch,/awaitCommands:\(\)=>\{botPolicy=\{\.\.\.botPolicy,awaitingCommand:true,runScope:'task'\};atomicJson\(botPolicyPath,botPolicy\);\}/);
});
