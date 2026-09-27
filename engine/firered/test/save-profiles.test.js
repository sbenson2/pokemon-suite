import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaveVault} from '../src/suite/save-vault.js';
import {backupGameProfile,readGameProfile} from '../src/suite/save-profiles.js';
import * as profiles from '../src/suite/save-profiles.js';
import {selectCampaignCartridge} from '../src/suite/campaign-context.js';

test('a hunt started on the native radio cartridge keeps that cartridge when execution config is regenerated',()=>{
 assert.equal(typeof profiles.createHuntSelection,'function');
 const selection=profiles.createHuntSelection('suicune',true);
 assert.equal(selectCampaignCartridge({cartridge:{path:'stock.gba'},nativeRadio:{huntId:'previous',cartridge:{path:'peer.gba'}}},selection).path,'peer.gba');
 assert.notEqual(selection.manual,true);
});

test('a newly created native profile keeps the same cartridge after the transient config is rebuilt',()=>{
 const cfg={cartridge:{path:'stock.gba'},nativeRadio:{huntId:'previous-hunt',cartridge:{path:'peer.gba'}}};
 const native=profiles.createGameProfileSelection?.('new-run','New run',true);
 const restored=JSON.parse(JSON.stringify(native??null));
 assert.equal(selectCampaignCartridge(cfg,restored).path,'peer.gba');
 assert.equal(restored.manual,true,'the emulator checkpoint is resumed for a fresh campaign');
 const stock=profiles.createGameProfileSelection('stock-run','Stock run',false);
 assert.equal(selectCampaignCartridge(cfg,stock).path,'stock.gba');
});
test('a new-game backup restores the exact previous checkpoint after the active save changes',()=>{
 const root=mkdtempSync(join(tmpdir(),'suite-profile-'));try{
  const identity={game:'firered',romSha1:'rom',coreSha256:'core'},vault=new SaveVault(join(root,'saves'),identity);
  vault.write(Buffer.from('old frame'),Buffer.from('old party'),{frame:12});
  const backup=backupGameProfile(root,vault,{label:'Original FireRed',active:{id:'hunt'}});
  vault.write(Buffer.from('new frame'),Buffer.from('new party'));
  vault.prune();
  const read=readGameProfile(root,backup.id,identity);
  assert.equal(read.vault.directory,vault.directory,'restored progress must use the vault the session reopens on restart');
  assert.equal(read.saved.state.toString(),'old frame');assert.equal(read.saved.sram.toString(),'old party');
  assert.equal(read.record.context.active.id,'hunt');
  read.vault.write(Buffer.from('continued frame'),Buffer.from('continued party'));
  read.vault.prune();
  assert.equal(readGameProfile(root,backup.id,identity).saved.state.toString(),'old frame');
  assert.throws(()=>readGameProfile(root,backup.id,{...identity,game:'emerald'}),/identity/);
  assert.throws(()=>readGameProfile(root,'../escape',identity),/Choose/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
