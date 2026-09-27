import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifiedReplayInputs} from '../scripts/replay-rom-inputs.mjs';

test('a native replay boots only the ROM bytes and config verified for its own case', () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-integrity-'));
  const sha = b => createHash('sha256').update(b).digest('hex');
  try {
    const bytes = Buffer.from('artificial test cartridge');
    const cartridge = {id: 'test-trade', path: join(root, 'game.gba')};
    writeFileSync(cartridge.path, bytes);
    const rawConfig = JSON.stringify({games: {firered: {nativeRadio: {cartridge}}}});
    writeFileSync(join(root, 'config.json'), rawConfig);
    const fixture = {id: 'pc-exit', config: 'config.json', nativeRadio: true};
    const receipt = {schema: 'pokemon-suite/rom-integrity/v1', cases: [{
      id: fixture.id, game: 'firered', nativeRadio: true, profile: 'test-trade',
      configSha256: sha(rawConfig), romSha256: sha(bytes),
    }]};
    const read = (f = fixture, r = receipt) => verifiedReplayInputs(join(root, 'corpus.json'), f, r);
    assert.deepEqual(read().romBytes, bytes);
    assert.throws(() => read({...fixture, id: 'different'}), /ROM integrity/);
    assert.throws(() => read({...fixture, nativeRadio: false}), /ROM integrity/);
    assert.throws(() => read(fixture, {...receipt, cases: [...receipt.cases, ...receipt.cases]}), /ROM integrity/);
    assert.throws(() => read(fixture, null), /ROM integrity/);
    writeFileSync(join(root, 'config.json'), rawConfig+' ');
    assert.throws(() => read(), /config changed/);
    writeFileSync(join(root, 'config.json'), rawConfig);
    writeFileSync(cartridge.path, Buffer.from('substituted after preflight'));
    assert.throws(() => read(), /ROM changed/);
    writeFileSync(cartridge.path, bytes);
    assert.deepEqual(read().romBytes, bytes);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('a paired replay requires and rechecks the companion ROM receipt',()=>{
 const root=mkdtempSync(join(tmpdir(),'paired-integrity-')),sha=b=>createHash('sha256').update(b).digest('hex');
 try{
  const bytes=Buffer.from('source'),peer=Buffer.from('partner'),a={id:'source',path:join(root,'a.gba')},b={id:'emerald-us',path:join(root,'b.gba')};writeFileSync(a.path,bytes);writeFileSync(b.path,peer);
  const raw=JSON.stringify({games:{firered:{cartridge:a},emerald:{cartridge:b}}});writeFileSync(join(root,'config.json'),raw);
  const fixture={id:'paired',config:'config.json',nativeRadio:false,partnerGame:'emerald'},receipt={schema:'pokemon-suite/rom-integrity/v1',cases:[{id:'paired',game:'firered',nativeRadio:false,profile:'source',configSha256:sha(raw),romSha256:sha(bytes)}]};
  const read=()=>verifiedReplayInputs(join(root,'corpus.json'),fixture,receipt);
  assert.throws(read,/partner/i);receipt.cases[0].partner={game:'emerald',profile:'emerald-us',romSha256:sha(peer)};
  assert.deepEqual(read().partnerRomBytes,peer);writeFileSync(b.path,Buffer.from('changed'));assert.throws(read,/partner.*changed/i);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a FireRed partner replay boots only the same verified native cartridge as its case',()=>{
 const root=mkdtempSync(join(tmpdir(),'firered-partner-integrity-')),sha=b=>createHash('sha256').update(b).digest('hex');
 try{
  const bytes=Buffer.from('reviewed peer trade'),cartridge={id:'firered-rev1-peer-trade-v2',path:join(root,'trade.gba')};writeFileSync(cartridge.path,bytes);
  const raw=JSON.stringify({games:{firered:{nativeRadio:{cartridge}},'firered-partner':{title:'firered',role:'partner',nativeRadio:{cartridge}}}});writeFileSync(join(root,'config.json'),raw);
  const fixture={id:'pair',config:'config.json',nativeRadio:true,partnerOwner:'firered-partner'};
  const receipt={schema:'pokemon-suite/rom-integrity/v1',cases:[{id:'pair',game:'firered',nativeRadio:true,profile:cartridge.id,configSha256:sha(raw),romSha256:sha(bytes)}]};
  const read=()=>verifiedReplayInputs(join(root,'corpus.json'),fixture,receipt);
  assert.throws(read,/partner/i);
  receipt.cases[0].partner={game:'firered',owner:'firered-partner',profile:cartridge.id,romSha256:sha(bytes)};
  const inputs=read();assert.equal(inputs.partnerOwner,'firered-partner');assert.deepEqual(inputs.partnerRomBytes,bytes);assert.equal(inputs.partnerCfg.title,'firered');
  receipt.cases[0].partner.owner='firered';assert.throws(read,/partner/i);
 }finally{rmSync(root,{recursive:true,force:true});}
});
