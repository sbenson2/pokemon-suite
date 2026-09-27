import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaveVault} from '../src/suite/save-vault.js';

test('game saves resume exact paired bytes, preserve anchors and reject another ROM', t => {
  const root=mkdtempSync(join(tmpdir(),'suite-save-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const identity={game:'firered',romSha1:'one',coreSha256:'core'};
  const a=new SaveVault(join(root,'firered'),identity),b=new SaveVault(join(root,'emerald'),{...identity,game:'emerald'});
  const original=a.write(Buffer.from('state1'),Buffer.from('save1'),{frame:10});
  b.write(Buffer.from('stateE'),Buffer.from('saveE'));
  a.write(Buffer.from('state2'),Buffer.from('save2'),{anchor:original});
  assert.equal(a.read().state.toString(),'state2');assert.equal(b.read().sram.toString(),'saveE');
  assert.equal(a.read(original).sram.toString(),'save1');
  assert.throws(()=>new SaveVault(a.directory,{...identity,romSha1:'wrong'}).read(),/identity/);
  writeFileSync(join(a.directory,a.current().statePath),'corrupt');
  assert.throws(()=>a.read(),/checksum/);
  assert.equal(a.read(original).state.toString(),'state1');
});

test('uncommitted files cannot replace the current save', t=>{
 const root=mkdtempSync(join(tmpdir(),'suite-save-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const vault=new SaveVault(root,{game:'crystal'});
 vault.write(Buffer.from('state'),Buffer.from('save'),{requestId:'hunt'});
 writeFileSync(join(root,'current.json.interrupted'),'{}');
 assert.equal(vault.read().metadata.requestId,'hunt');
 assert.equal(JSON.parse(readFileSync(join(root,'current.json'))).schema,'pokemon-suite/save/v1');
 assert.throws(()=>vault.read({...vault.current(),statePath:'../outside'}),/path/);
});
test('pruning retains the current save and the explicitly protected encounter anchor',t=>{
 const root=mkdtempSync(join(tmpdir(),'suite-save-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const vault=new SaveVault(root,{game:'firered'});
 const anchor=vault.write(Buffer.from('anchor'),Buffer.from('native'));
 const obsolete=vault.write(Buffer.from('old'),Buffer.from('native'));
 vault.write(Buffer.from('latest'),Buffer.from('native'));
 vault.prune([anchor]);
 assert.equal(vault.read(anchor).state.toString(),'anchor');assert.equal(vault.read().state.toString(),'latest');
 assert.throws(()=>vault.read(obsolete),/ENOENT/);
});
