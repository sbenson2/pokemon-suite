#!/usr/bin/env node
// Extra saves: read-only inventories of archived FireRed save profiles. Each
// profile's native save is copied to a private temporary folder and cold-booted
// in a throwaway pinned emulator; the profile itself is never written and no
// input reaches any live game. A profile whose native save does not continue
// (state-only archives) is reported as unsaved.
import {readFileSync,mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {SaveVault} from './save-vault.js';
import {createPinnedMgbaSession} from '../emulator/pinned-mgba.js';
import {createFireRedObserver} from '../evidence/fire-red-observer.js';
import {continueNativeSaveAsync} from './native-cold-boot.js';
import {readPostgameEvidence,POSTGAME_WATCH} from './postgame-agenda.js';
import {describeSaveInventory,EXTRA_SAVE_WATCH} from './extra-saves.js';

const json=p=>JSON.parse(readFileSync(p,'utf8'));
const PROFILE=/^[a-f0-9-]{36}$/;

export async function readProfileInventory({config,profile}){
 const cfg=config.games.firered,directory=join(config.directory,'firered','save-profiles');
 if(!PROFILE.test(profile.profileId??''))throw Error('Choose an archived FireRed save profile.');
 const entry=json(join(directory,`${profile.profileId}.json`));
 if(!resolve(entry.directory).startsWith(resolve(directory)+'/'))throw Error('The profile does not belong to this FireRed owner.');
 const record=entry.source,tmp=mkdtempSync(join(tmpdir(),'suite-extra-save-profile-'));
 try{
  for(const name of [record.statePath,record.sramPath])copyFileSync(join(entry.directory,name),join(tmp,name));
  const saved=new SaveVault(tmp,record.identity).read(record);
  const {readVerifiedCartridge}=await import(pathToFileURL(join(config.researchBots,'shared/cartridge.js')));
  const native=cfg.nativeRadio?.cartridge&&cfg.nativeRadio?.core?cfg.nativeRadio:{cartridge:cfg.cartridge,core:cfg.core};
  const cartridge=await readVerifiedCartridge(native.cartridge);
  if(cartridge.identity.sha1!==record.identity.romSha1)return {profileId:profile.profileId,sramSha256:record.sramSha256,inventory:null,reason:'The profile belongs to another cartridge.'};
  const manifest=json(join(native.core,'build-manifest.json'));
  const inputs=Object.fromEntries(['runtime','world','story','battle'].map(k=>[k,json(cfg.inputs[k])]));
  const session=await createPinnedMgbaSession({coreDirectory:native.core,romBytes:cartridge.bytes,cartridge:cartridge.identity,expected:{mgbaCommit:manifest.mgba_commit,wrapperCommit:manifest.wrapper_commit,mgbaWasmSha256:manifest.mgba_wasm_sha256}});
  try{
   session.loadSram(saved.sram);
   const observer=createFireRedObserver({session,...inputs,runId:'extra-save-profile-inventory',storyWatch:{flags:[...new Set([...EXTRA_SAVE_WATCH.flags,...POSTGAME_WATCH.flags])],variables:[...new Set([...EXTRA_SAVE_WATCH.variables,...POSTGAME_WATCH.variables])]}});
   let o;
   try{o=await continueNativeSaveAsync(session,observer);}
   catch(error){return {profileId:profile.profileId,sramSha256:record.sramSha256,inventory:null,reason:`No continuable native save: ${error.message}`};}
   const evidence=readPostgameEvidence(session,inputs.runtime,o);
   const inventory=describeSaveInventory({observation:o,world:inputs.world,roamer:evidence?.roamer??null,source:{kind:'profile',profileId:profile.profileId,label:profile.label??entry.label??'Archived FireRed save',saved:true}});
   return {profileId:profile.profileId,sramSha256:record.sramSha256,inventory,reason:null};
  }finally{session.close();}
 }finally{rmSync(tmp,{recursive:true,force:true});}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>65536)throw Error('The profile request is too large.');}
  const request=JSON.parse(input),config=json(process.argv[2]);
  if(!Array.isArray(request.profiles)||request.profiles.length>64)throw Error('Choose up to 64 archived profiles.');
  const profiles=[];
  for(const profile of request.profiles){
   try{profiles.push(await readProfileInventory({config,profile}));}
   catch(error){profiles.push({profileId:profile?.profileId??null,inventory:null,reason:error.message});}
  }
  process.stdout.write(JSON.stringify({schema:'pokemon-suite/extra-save-profile-inventories/v1',profiles}));
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
