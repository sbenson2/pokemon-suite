import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignSupervisor} from '../src/player/campaign-supervisor.js';

test('a reviewed stall retry retains history and lifetime accounting and remains bounded across restarts',()=>{
  let now=0;
  let supervisor=createCampaignSupervisor({clock:()=>now,progressTimeoutMs:100});
  for(let attempt=0;attempt<3;attempt++) {
    now+=101;assert.equal(supervisor.observe().stopReason,'no-meaningful-progress');supervisor.pause();
    const stopped=supervisor.state();supervisor.resume();
    assert.equal(supervisor.observe().stopReason,'no-meaningful-progress','ordinary resume must not clear a safety stop');
    supervisor.pause();supervisor.retryReviewedStop({objective:'badge-marsh',frame:100+attempt});
    const retried=supervisor.state();
    assert.equal(retried.stopReason,null);assert.equal(retried.idleMs,0);assert.equal(retried.elapsedMs,stopped.elapsedMs);
    assert.deepEqual(retried.achievements,stopped.achievements);assert.deepEqual(retried.experience,stopped.experience);
    assert.equal(retried.reviewedRetries.length,attempt+1);assert.equal(retried.reviewedRetries.at(-1).idleMs,stopped.idleMs);
    supervisor=createCampaignSupervisor({clock:()=>now,progressTimeoutMs:100,initialState:JSON.parse(JSON.stringify(retried))});
  }
  now+=101;supervisor.observe();supervisor.pause();
  assert.throws(()=>supervisor.retryReviewedStop({objective:'badge-marsh',frame:104}),/limit/i);
  assert.equal(supervisor.state().stopReason,'no-meaningful-progress');
});

test('escort XP cannot indefinitely extend the active trainees progress deadline',()=>{
 let now=0;const s=createCampaignSupervisor({clock:()=>now,progressTimeoutMs:100});
 const sample=xp=>({observation:{phase:'stable',emulator:{mode:'overworld'},playerMemory:{map:{id:'MAP_ROUTE21'},storyState:{},trainer:{party:[
  {otId:1,personality:2,experience:100},{otId:1,personality:3,experience:xp}]}}},task:{kind:'training',member:'[1,2]'}});
 s.observe(sample(200));now=60;s.observe(sample(300));now=101;
 assert.equal(s.observe(sample(400)).stopReason,'no-meaningful-progress');
});

test('automatic recovery requires a distinct strategy and retains consumed time and retry history',()=>{
 let now=0,s=createCampaignSupervisor({clock:()=>now,progressTimeoutMs:100});
 now=101;s.observe();assert.equal(typeof s.beginRecovery,'function');
 assert.equal(s.beginRecovery({kind:'alternate-healer',from:{map:'MAP_A',index:0},to:{map:'MAP_A',index:0}}),false);
 assert.equal(s.state().stopReason,'no-meaningful-progress');
 const strategy={kind:'alternate-healer',from:{map:'MAP_A',index:0},to:{map:'MAP_A',index:1}};
 assert.equal(s.beginRecovery(strategy),true);assert.equal(s.state().elapsedMs,101);
 assert.equal(s.state().stopReason,null);
 s=createCampaignSupervisor({clock:()=>now,progressTimeoutMs:100,initialState:JSON.parse(JSON.stringify(s.state()))});
 now=202;s.observe();assert.equal(s.beginRecovery(strategy),false,'restarting cannot retry the same failed strategy');
 assert.equal(s.state().stopReason,'no-meaningful-progress');
});
