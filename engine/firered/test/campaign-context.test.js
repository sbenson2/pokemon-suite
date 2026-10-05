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

// extra-saves (build 126): a helper FireRed owner must preview its campaign on
// the cartridge its own worker boots. 125.1 previewed with the MAIN owner's
// config and active native hunt (peer-trade cartridge) while the helper worker
// booted the stock cartridge, so start-campaign refused the record ("The
// campaign preview belongs to another cartridge"). Helpers now boot the same
// reviewed native link pair as partners, and previews follow the named owner.
test('a helper owner previews its campaign on the same reviewed link cartridge its worker boots',async t=>{
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const owners=await import('../src/suite/suite-owner.js');
 const directory=mkdtempSync(join(tmpdir(),'campaign-owner-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const stock={path:'stock.gba',sha1:'dd5945db9b930750cb39d00c84da8571feebf417'},peer={path:'peer.gba',sha1:'85a259c7b7a74d4f2322e5b9f89d22a53dfd6fce'};
 const nativeRadio={huntId:'main-hunt',cartridge:peer,core:'/native-core'};
 const config={directory,games:{firered:{cartridge:stock,core:'/stock-core',nativeRadio},
  'firered-helper-1':{title:'firered',role:'helper',cartridge:stock,core:'/stock-core',nativeRadio}}};
 for(const owner of ['firered','firered-helper-1'])mkdirSync(join(directory,owner));
 writeFileSync(join(directory,'firered','active-hunt.json'),JSON.stringify({id:'main-hunt',nativeRadio:true}));
 const helperCfg=config.games['firered-helper-1'];
 // What the worker boots for this owner (125.1: partners only), and what the
 // preview CLI binds for it (125.1: the main owner's selection).
 const boot=(owners.ownerNativePair?.(helperCfg,{helper:true})?.cartridge)??helperCfg.cartridge;
 const preview=context.ownerCampaignCartridge?.(config,'firered-helper-1')??context.selectCampaignCartridge(config.games.firered,{id:'main-hunt',nativeRadio:true});
 assert.equal(preview.sha1,boot.sha1,'the preview and the worker must bind one cartridge');
 assert.equal(boot.sha1,peer.sha1,'a helper boots the reviewed peer-trade cartridge like a partner');
 // A helper that starts a hunt of its own keeps that pair.
 writeFileSync(join(directory,'firered-helper-1','active-hunt.json'),JSON.stringify({id:'helper-hunt',nativeRadio:false}));
 assert.equal(context.ownerCampaignCartridge(config,'firered-helper-1').sha1,peer.sha1);
 // The main owner is unchanged: its preview follows its own active hunt.
 assert.equal(context.ownerCampaignCartridge(config,'firered').sha1,peer.sha1);
 writeFileSync(join(directory,'firered','active-hunt.json'),JSON.stringify({id:'ordinary',nativeRadio:false}));
 assert.equal(context.ownerCampaignCartridge(config,'firered').sha1,stock.sha1);
 assert.equal(owners.ownerNativePair({...helperCfg,role:undefined},{}),null,'the main owner never boots the link pair by role');
 // Without a configured link pair a helper stays on the verified stock cartridge.
 const plain={title:'firered',role:'helper',cartridge:stock,core:'/stock-core'};
 assert.equal(owners.ownerNativePair(plain,{helper:true}),null);
 assert.equal(context.ownerCampaignCartridge({directory,games:{firered:config.games.firered,'firered-helper-1':plain}},'firered-helper-1').sha1,stock.sha1);
 assert.throws(()=>context.ownerCampaignCartridge(config,'emerald'),/Unknown configured Suite game|FireRed/);
});
