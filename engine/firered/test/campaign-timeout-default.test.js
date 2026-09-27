import assert from 'node:assert/strict';
import test from 'node:test';
import {createCampaignSupervisor} from '../src/player/campaign-supervisor.js';
import {createCampaignEpisodeMonitor} from '../src/player/campaign-episode.js';

test('the live campaign stops after five active real minutes without progress',()=>{
  let now=0;const supervisor=createCampaignSupervisor({clock:()=>now});
  supervisor.observe();now=299999;assert.equal(supervisor.observe().stopReason,null);
  now=300000;assert.equal(supervisor.observe().stopReason,'no-meaningful-progress');
  assert.equal(supervisor.state().progressTimeoutMs,300000);
});
test('qualification uses the same five-minute no-progress deadline',()=>{
  let now=0;const monitor=createCampaignEpisodeMonitor({target:'hall-of-fame',maxGameSeconds:null,clock:()=>now});
  const update={decisions:1,decision:{kind:'resample'},observation:{frame:1,phase:'transition',emulator:{mode:'overworld'},playerMemory:{}}};
  monitor.observe(update);now=299999;assert.equal(monitor.observe(update).stopReason,null);
  now=300000;assert.equal(monitor.observe(update).stopReason,'no-meaningful-progress');
});
test('an older checkpoint adopts five minutes without resetting consumed time or charging offline time',()=>{
  let now=0,supervisor=createCampaignSupervisor({clock:()=>now,progressTimeoutMs:900000});
  supervisor.observe();now=250000;supervisor.observe();supervisor.pause();
  const saved=JSON.parse(JSON.stringify(supervisor.state()));now=10000000;
  supervisor=createCampaignSupervisor({clock:()=>now,initialState:saved});
  assert.equal(supervisor.state().idleMs,250000);assert.equal(supervisor.state().progressTimeoutMs,300000);
  now+=49999;assert.equal(supervisor.observe().stopReason,null);
  now++;assert.equal(supervisor.observe().stopReason,'no-meaningful-progress');
  assert.equal(supervisor.state().elapsedMs,300000);
});
