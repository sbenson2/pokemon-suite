import test from 'node:test';
import assert from 'node:assert/strict';
import * as context from '../src/suite/campaign-context.js';

const cfg={cartridge:{path:'stock.gba',sha1:'stock'},nativeRadio:{huntId:'older-profile',cartridge:{path:'peer.gba',sha1:'peer'}}};

test('campaign preview honors an explicit native-radio save after the configured hunt changes',()=>{
 assert.deepEqual(context.selectCampaignCartridge?.(cfg,{id:'current-profile',nativeRadio:true}),
   {path:'peer.gba',sha1:'peer'});
});

test('campaign preview preserves legacy native-radio selection and ordinary cartridge selection',()=>{
 for(const [active,want] of [
  [{id:'older-profile'},'peer.gba'],
  [{id:'ordinary-profile'},'stock.gba'],
  [null,'stock.gba'],
 ]) assert.equal(context.selectCampaignCartridge?.(cfg,active)?.path,want);
});

test('a native-radio core may use the verified stock cartridge when no alternate ROM is configured',()=>{
 assert.equal(context.selectCampaignCartridge?.({cartridge:cfg.cartridge,nativeRadio:{huntId:'active'}},
   {id:'active',nativeRadio:true})?.path,'stock.gba');
});
