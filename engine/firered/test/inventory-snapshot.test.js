import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveInventoryCheckpoint} from '../src/suite/inventory-snapshot.js';

test('an archived inventory chooses its own ROM and core rather than the current campaign',()=>{
 const root=mkdtempSync(join(tmpdir(),'suite-inventory-'));
 const put=(path,value)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,JSON.stringify(value));};
 try{
  const core=join(root,'stock'),rfu=join(root,'rfu');
  put(join(core,'build-manifest.json'),{mgba_wasm_sha256:'stock-core'});put(join(rfu,'build-manifest.json'),{mgba_wasm_sha256:'rfu-core'});
  const config={directory:root,games:{firered:{core,cartridge:{sha1:'stock-rom'},nativeRadio:{core:rfu,cartridge:{sha1:'rfu-rom'},huntId:'current-test'}}}};
  put(join(root,'firered/active-hunt.json'),{id:'current-test'});
  put(join(root,'firered/save-profiles/collection/current.json'),{identity:{game:'firered',romSha1:'rfu-rom',coreSha256:'rfu-core'}});
  const source=resolveInventoryCheckpoint({config,game:'firered',profileId:'collection'});
  assert.equal(source.core,rfu);assert.equal(source.cartridge.sha1,'rfu-rom');assert.equal(source.directory,join(root,'firered/save-profiles/collection'));
  assert.equal(source.ownerId,null);
  assert.throws(()=>resolveInventoryCheckpoint({config,game:'firered',profileId:'../escape'}),/identifier/);
  put(join(root,'firered/save-profiles/collection/current.json'),{identity:{game:'firered',romSha1:'other-rom',coreSha256:'rfu-core'}});
  assert.throws(()=>resolveInventoryCheckpoint({config,game:'firered',profileId:'collection'}),/matching/);
  // Loading an RFU profile keeps its own adapter after the original hunt ID changes.
  put(join(root,'firered/active-hunt.json'),{id:'restored-collection',nativeRadio:true});
  put(join(root,'firered/hunts/restored-collection/native-radio/saves/current.json'),{});
  const active=resolveInventoryCheckpoint({config,game:'firered'});
  assert.equal(active.core,rfu);assert.equal(active.cartridge.sha1,'rfu-rom');
 }finally{rmSync(root,{recursive:true,force:true});}
});
