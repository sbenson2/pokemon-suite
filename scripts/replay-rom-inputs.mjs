// Bind preflight evidence to the bytes actually passed into the emulator.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifiedReplayInputs(corpusPath, fixture, receipt) {
  assert.equal(receipt?.schema, 'pokemon-suite/rom-integrity/v1', 'ROM integrity receipt is required');
  const matches = receipt.cases?.filter(c => c.id === fixture.id) ?? [];
  assert.equal(matches.length, 1, 'ROM integrity receipt must identify this case exactly once');
  const evidence = matches[0];
  // LeafGreen (build 124) cases run its reviewed stock image only.
  assert.ok(['firered', 'leafgreen'].includes(evidence.game) && (fixture.game ?? 'firered') === evidence.game &&
    evidence.nativeRadio === fixture.nativeRadio, 'ROM integrity receipt belongs to a different game or mode');
  const raw = readFileSync(resolve(dirname(corpusPath), fixture.config));
  assert.equal(sha256(raw), evidence.configSha256, 'The replay config changed after ROM verification');
  const cfg = JSON.parse(raw).games[evidence.game];
  const cartridge = fixture.nativeRadio ? cfg.nativeRadio.cartridge : cfg.cartridge;
  assert.equal(cartridge.id, evidence.profile, 'ROM integrity profile changed');
  const romBytes = readFileSync(cartridge.path);
  assert.equal(sha256(romBytes), evidence.romSha256, 'The ROM changed after verification');
  let partnerCfg,partnerRomBytes,partnerOwner;
  if(fixture.partnerOwner){
    // A second FireRed owner runs this case's own verified native cartridge.
    assert.ok(fixture.nativeRadio&&!fixture.partnerGame,'A FireRed partner case uses the native link cartridge and one partner');
    assert.ok(evidence.partner?.game==='firered'&&evidence.partner.owner===fixture.partnerOwner&&evidence.partner.profile===evidence.profile,'The FireRed partner ROM integrity receipt is missing or belongs to another owner');
    partnerOwner=fixture.partnerOwner;partnerCfg=JSON.parse(raw).games[partnerOwner];
    assert.ok(partnerCfg?.title==='firered'&&partnerCfg.role==='partner','The FireRed partner owner is not a declared partner');
    const native=partnerCfg.nativeRadio?.cartridge;
    assert.ok(native?.id===cartridge.id&&native.path===cartridge.path,'The FireRed partner ROM profile changed');
    partnerRomBytes=readFileSync(native.path);
    assert.equal(sha256(partnerRomBytes),evidence.partner.romSha256,'The FireRed partner ROM changed after verification');
  }
  if(fixture.partnerGame){
    assert.equal(evidence.partner?.game,fixture.partnerGame,'The partner ROM integrity receipt is missing or belongs to another game');
    partnerCfg=JSON.parse(raw).games[fixture.partnerGame];
    assert.equal(partnerCfg?.cartridge?.id,evidence.partner.profile,'The partner ROM profile changed');
    partnerRomBytes=readFileSync(partnerCfg.cartridge.path);
    assert.equal(sha256(partnerRomBytes),evidence.partner.romSha256,'The partner ROM changed after verification');
  }
  return {cfg, cartridge, romBytes,partnerCfg,partnerRomBytes,partnerOwner};
}
