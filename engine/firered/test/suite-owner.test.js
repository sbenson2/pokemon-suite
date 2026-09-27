import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveSuiteOwner} from '../src/suite/suite-owner.js';
import {SaveVault} from '../src/suite/save-vault.js';

// A second FireRed owner has its own key (directory, lock, port and RFU owner)
// but keeps the cartridge title in its save identity.
test('two FireRed owners resolve to separate directories while their saves keep the FireRed title identity',t=>{
 const root=mkdtempSync(join(tmpdir(),'suite-owners-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const config={directory:root,games:{firered:{port:1},'firered-partner':{title:'firered',role:'partner',port:2},emerald:{port:3}}};
 const main=resolveSuiteOwner(config,'firered'),partner=resolveSuiteOwner(config,'firered-partner'),emerald=resolveSuiteOwner(config,'emerald');
 assert.deepEqual([main.owner,main.title,main.partner],['firered','firered',false]);
 assert.deepEqual([partner.owner,partner.title,partner.partner],['firered-partner','firered',true]);
 assert.deepEqual([emerald.owner,emerald.title,emerald.partner],['emerald','emerald',false]);
 assert.equal(main.directory,join(root,'firered'));assert.equal(partner.directory,join(root,'firered-partner'));
 assert.notEqual(main.lockPath,partner.lockPath);assert.equal(partner.lockPath,join(root,'firered-partner','owner.lock'));
 // Both owners write FireRed-identity saves into their own vaults only.
 const identity={game:partner.title,romSha1:'a'.repeat(40),coreSha256:'b'.repeat(64)};
 const a=new SaveVault(join(main.directory,'saves'),identity),b=new SaveVault(join(partner.directory,'saves'),identity);
 a.write(Buffer.from('main state'),Buffer.from('main sram'));b.write(Buffer.from('partner state'),Buffer.from('partner sram'));
 assert.equal(a.read().sram.toString(),'main sram');assert.equal(b.read().sram.toString(),'partner sram');
 assert.equal(JSON.parse(readFileSync(join(partner.directory,'saves','current.json'))).identity.game,'firered');
 for(const [games,key] of [
  [{firered:{role:'partner'}},'firered'],                       // the source owner cannot be a partner
  [{'firered-partner':{title:'firered'}},'firered-partner'],    // a second owner of a title must be a declared partner
  [{'emerald-2':{title:'emerald',role:'partner'}},'emerald-2'],  // only FireRed partners are implemented
  [{'Bad Key':{title:'firered',role:'partner'}},'Bad Key'],
  [{firered:{}},'missing'],
 ])assert.throws(()=>resolveSuiteOwner({directory:root,games},key),/Unknown configured Suite game/);
});
