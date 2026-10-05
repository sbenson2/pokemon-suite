import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {SaveVault} from './save-vault.js';
import {createPinnedMgbaSession} from '../emulator/pinned-mgba.js';
import {createFireRedObserver} from '../evidence/fire-red-observer.js';
import {pokemonInventory} from './pokemon-inventory.js';

const json=path=>JSON.parse(readFileSync(path,'utf8'));
export function resolveInventoryCheckpoint({config,game,profileId}){
 if(game!=='firered')throw Error('Verified PC reading is currently available for FireRed.');
 const cfg=config.games?.[game];if(!cfg)throw Error('Configure this game first.');
 if(profileId!==undefined){
  if(typeof profileId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(profileId))throw Error('Invalid saved profile identifier.');
  const directory=join(config.directory,game,'save-profiles',profileId);
  const checkpoint=json(join(directory,'current.json'));
  for(const candidate of [cfg,cfg.nativeRadio].filter(Boolean)){
   if(!candidate.core||!existsSync(join(candidate.core,'build-manifest.json')))continue;
   const manifest=json(join(candidate.core,'build-manifest.json')),cartridge=candidate.cartridge??cfg.cartridge;
   if(checkpoint.identity?.game===game&&checkpoint.identity.romSha1===cartridge.sha1&&checkpoint.identity.coreSha256===manifest.mgba_wasm_sha256)
    return {directory,core:candidate.core,cartridge,manifest,ownerId:null};
  }
  throw Error('This saved collection needs its matching cartridge and emulator resources.');
 }
 const folder=join(config.directory,game),activePath=join(folder,'active-hunt.json');
 const active=existsSync(activePath)?json(activePath):null;
 if(active&&!/^[a-zA-Z0-9_-]{1,100}$/.test(active.id))throw Error('Invalid active save identifier.');
 const native=Boolean(active&&(active.nativeRadio===true||cfg.nativeRadio?.huntId===active.id));
 const core=native?cfg.nativeRadio.core:cfg.core,cartridge=native?(cfg.nativeRadio.cartridge??cfg.cartridge):cfg.cartridge;
 const directory=active?join(folder,'hunts',active.id,...(native?['native-radio','saves']:['saves'])):join(folder,'saves');
 if(!existsSync(join(directory,'current.json')))throw Error('Start this game once to create its first local checkpoint.');
 const manifest=json(join(core,'build-manifest.json'));
 return {directory,core,cartridge,manifest,ownerId:active?.id??null};
}

export async function readInventorySnapshot({config,game,profileId}){
 const {directory,core,cartridge,manifest,ownerId}=resolveInventoryCheckpoint({config,game,profileId});
 const cfg=config.games[game];
 const identity={game,romSha1:cartridge.sha1,coreSha256:manifest.mgba_wasm_sha256};
 const saved=new SaveVault(directory,identity).read();
 const rom=readFileSync(cartridge.path);
 if(createHash('sha1').update(rom).digest('hex')!==identity.romSha1)throw Error('The selected cartridge failed its identity check.');
 const session=await createPinnedMgbaSession({coreDirectory:core,romBytes:rom,cartridge:{...cartridge,bytes:rom.length},
  expected:{mgbaCommit:manifest.mgba_commit,wrapperCommit:manifest.wrapper_commit,mgbaWasmSha256:manifest.mgba_wasm_sha256}});
 try{
  session.loadSram(saved.sram);session.loadState(saved.state);
  const inputs=Object.fromEntries(['runtime','world','story','battle'].map(k=>[k,json(cfg.inputs[k])]));
  const observation=createFireRedObserver({session,...inputs,runId:'inventory-read-only'}).capture();
  const result=pokemonInventory(game,observation.playerMemory?.trainer);
  return {schema:'pokemon-suite/inventory/v1',game,...result,source:'checkpoint',
   save:{id:saved.stateSha256,updatedAt:saved.updatedAt,frame:saved.metadata?.frame,ownerId},
   trainer:observation.playerMemory?.trainer?.playerName??null,
   // The save's own OT ID, so the read-only legality checker can tell caught from traded Pokémon.
   trainerOtId:Number.isInteger(observation.playerMemory?.trainer?.otId)?observation.playerMemory.trainer.otId:null};
 }finally{session.close();}
}
