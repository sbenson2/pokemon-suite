import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from '../native/ios/node_modules/esbuild/lib/main.js';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const root=fileURLToPath(new URL('../',import.meta.url));
async function browserEntry(source){
 const result=await build({stdin:{contents:source,resolveDir:root},bundle:true,write:false,format:'iife',
  globalName:'Subject',platform:'browser',target:'safari17',alias:{
   'node:crypto':root+'native/ios/Runtime/crypto.js','node:util':root+'native/ios/Runtime/util.js'},
  inject:[root+'native/ios/Runtime/globals.js']});
 const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,structuredClone,console,setTimeout,clearTimeout,performance});
 vm.runInContext(result.outputFiles[0].text,context);
 return context.Subject;
}

test('browser crypto preserves desktop campaign commitments and binary hashing',async()=>{
 const api=await browserEntry(`export {createHash,randomBytes,randomUUID} from './native/ios/Runtime/crypto.js';`);
 assert.equal(api.createHash('sha256').update('a').update('bc').digest('hex'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 assert.equal(api.createHash('sha1').update(new Uint8Array([97,98,99])).digest('hex'),'a9993e364706816aba3e25717850c26c9cd0d89d');
 assert.equal(api.randomBytes(32).length,32);
 assert.match(api.randomUUID(),/^[a-f0-9-]{36}$/);
 assert.throws(()=>api.createHash('unknown'));
});

test('browser run validation rejects altered nested team plans regardless of key ordering',async()=>{
 const api=await browserEntry(`export {isDeepStrictEqual} from './native/ios/Runtime/util.js';`);
 assert.equal(api.isDeepStrictEqual({team:[1,2],settings:{a:1,b:2}},{settings:{b:2,a:1},team:[1,2]}),true);
 assert.equal(api.isDeepStrictEqual({team:[1,2]},{team:[2,1]}),false);
 assert.equal(api.isDeepStrictEqual({team:[1,2]},{team:[1,3]}),false);
 assert.equal(api.isDeepStrictEqual({a:undefined},{}),false);
});

test('mobile checkpoint rejects mismatched cartridge or engine and corrupt save bytes',async()=>{
 const api=await browserEntry(`export {encodeCheckpoint,decodeCheckpoint} from './native/ios/Runtime/checkpoint.js';`);
 const identity={romSha1:'a'.repeat(40),coreSha256:'b'.repeat(64)};
 const state=new Uint8Array([1,2,3]),sram=new Uint8Array([4,5,6]);
 const record=api.encodeCheckpoint({identity,state,sram,campaign:null,decisions:8,frame:123});
 assert.equal(api.decodeCheckpoint(record,identity).frame,123);
 assert.deepEqual([...api.decodeCheckpoint(record,identity).state],[1,2,3]);
 assert.throws(()=>api.decodeCheckpoint(record,{...identity,romSha1:'c'.repeat(40)}));
 assert.throws(()=>api.decodeCheckpoint(record,{...identity,coreSha256:'c'.repeat(64)}));
 assert.throws(()=>api.decodeCheckpoint({...record,state:'CQID'},identity));
});

test('actual campaign and observer bundle run without Node globals or a server',async()=>{
 const api=await browserEntry(`export {validateRunSettings,createCampaignController} from './engine/firered/src/suite/campaign-run.js';
 export {createFireRedObserver} from './engine/firered/src/evidence/fire-red-observer.js';
 export {createAutonomousEmulator} from './engine/firered/src/emulator/autonomous-emulator.js';`);
 assert.equal(api.validateRunSettings({}).starter,'random');
 assert.throws(()=>api.validateRunSettings({starter:'pikachu'}));
 assert.equal(typeof api.createCampaignController,'function');
 assert.equal(typeof api.createFireRedObserver,'function');
});

test('real local emulator pauses without advancing and restores its own campaign checkpoint',
 {skip:!process.env.POKEMON_SUITE_MOBILE_TEST_CONFIG,timeout:30000},async()=>{
 const cfg=JSON.parse(readFileSync(process.env.POKEMON_SUITE_MOBILE_TEST_CONFIG)).games.firered;
 const manifest=JSON.parse(readFileSync(cfg.core+'/build-manifest.json'));
 const source=readFileSync(cfg.core+'/mgba.js','utf8');
 const factory=new Function('require','__dirname','__filename',source+';return createMgbaModule;')(
  createRequire(cfg.core+'/mgba.js'),cfg.core,cfg.core+'/mgba.js');
 const assets={rom:new Uint8Array(readFileSync(cfg.cartridge.path)),wasm:new Uint8Array(readFileSync(cfg.core+'/mgba.wasm')),
  manifest,inputs:Object.fromEntries(['runtime','world','story','battle'].map(k=>[k,JSON.parse(readFileSync(cfg.inputs[k]))]))};
 const api=await browserEntry(`export {createLocalGame} from './native/ios/Runtime/host.js';`);
 let game;try{
  game=await api.createLocalGame({assets,createModule:factory});
  assert.equal(game.status().mode,'paused');
  const preview=game.prepareCampaign({starter:'squirtle'});
  assert.equal(preview.starter.species,7);
  await game.startCampaign();
  await new Promise(r=>setTimeout(r,1200));
  const saved=await game.pause();
  assert.ok(saved.frame>0);
  assert.ok(saved.decisions>0);
  const frame=game.status().frame;
  await new Promise(r=>setTimeout(r,150));
  assert.equal(game.status().frame,frame);
  assert.equal(saved.campaign.record.commitment,preview.commitment);
  await game.close();game=null;
  game=await api.createLocalGame({assets,createModule:factory,checkpoint:saved});
  assert.equal(game.status().frame,frame);
  assert.equal(game.status().campaign.commitment,preview.commitment);
  assert.equal(game.status().mode,'paused');
 }finally{await game?.close();}
});
