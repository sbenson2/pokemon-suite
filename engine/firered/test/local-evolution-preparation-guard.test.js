import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalEvolutionWorker} from '../src/suite/local-evolution-worker.js';

// Live September 23: after a completed exchange, FireRed briefly reported the
// next request as waiting for transfer before its trade preparation existed,
// while the Emerald partner was already ready. The local worker dereferenced the
// missing preparation (TypeError: reading 'pokemon'). It must wait instead.
test('the local worker waits for FireRed trade preparation before reserving a partner exchange',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'evolution-guard-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 mkdirSync(join(directory,'emerald'));mkdirSync(join(directory,'core'));
 writeFileSync(join(directory,'core','build-manifest.json'),JSON.stringify({native_rfu:true}));
 writeFileSync(join(directory,'emerald','status.json'),JSON.stringify({game:'emerald',bot:{enabled:true,preparation:{phase:'ready-for-transfer',requestId:'next',transferCandidate:{species:16}}}}));
 const worker=createLocalEvolutionWorker({game:'firered',config:{directory,games:{emerald:{core:join(directory,'core')}}},coreManifest:{native_rfu:true},state:null,hooks:{
  enabled:()=>true,fireRedState:()=>({dexEvolution:{requestId:'next',steps:[]},preparation:{requestId:'next',phase:'waiting-for-transfer'}}),
  observe:()=>({playerMemory:{trainer:{trainerId:10933}}}),persist(){},progress(){},
 }});
 const errors=t.mock.method(console,'error',()=>{});
 await worker.poll();
 assert.equal(errors.mock.callCount(),0,'the poll does not fail on the missing preparation');
 assert.equal(worker.state(),null,'no exchange starts without the FireRed trade preparation');
});
