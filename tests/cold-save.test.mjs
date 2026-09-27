import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaveVault} from '../engine/firered/src/suite/save-vault.js';
import {ensureInitialSave} from '../engine/firered/src/suite/initial-save.js';
import {startCommandReady} from '../engine/firered/src/suite/console-power.js';

test('a newly initialized profile waits for a command without selecting Continue',async()=>{
  const events=[];
  await startCommandReady({newProfile:true},{stop:()=>events.push('stop'),checkpoint:()=>events.push('save'),continueSave:()=>{throw Error('No Continue save exists');},ready:()=>events.push('ready')});
  assert.deepEqual(events,['stop','save','ready']);
});

test('first launch creates its own cold checkpoint and never replaces existing progress',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'suite-cold-'));
  try {
    const vault=new SaveVault(directory,{game:'firered',romSha1:'test-rom',coreSha256:'test-core'});
    let closed=false;
    assert.equal(await ensureInitialSave(vault,{},async()=>({frame:0,saveState:()=>Buffer.from('cold state'),saveSram:()=>Buffer.alloc(128,255),close:()=>closed=true})),true);
    assert.equal(closed,true);
    assert.equal(vault.read().metadata.reason,'first-launch');
    vault.write(Buffer.from('player progress'),Buffer.from('cartridge progress'),{reason:'manual-save'});
    assert.equal(await ensureInitialSave(vault,{},()=>{throw Error('Existing save must not boot a new game');}),false);
    assert.equal(vault.read().state.toString(),'player progress');
  }finally{rmSync(directory,{recursive:true,force:true});}
});
