import {mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SaveVault,atomicJson} from './save-vault.js';

export function createGameProfileSelection(id,label,usingNativeRadio){
 return {id,manual:true,label:label.trim(),nativeRadio:usingNativeRadio===true};
}
// A hunt continues the selected save. Keep that save's name, so the next
// backup is not relabelled "Previous FireRed save"; it is not a manual profile.
export function createHuntSelection(id,usingNativeRadio,previous=null){
 const label=typeof previous?.label==='string'&&previous.label.trim()?previous.label:null;
 return {id,nativeRadio:usingNativeRadio===true,...(label?{label}:{})};
}
// Whether starting the bot on this profile must prepare New Game rather than
// Continue. A manual new save has no Continue entry until the player saves in
// game; a campaign's new save keeps its own flow; a restore follows its backup.
export function profileStartsNewGame({type,campaignId=null,restoredMetadata=null,previous=false}){
 if(type==='new-save')return campaignId?previous===true:true;
 if(type==='restore-save')return restoredMetadata?.newProfile===true;
 return previous===true;
}

export function backupGameProfile(directory,vault,context={}){
 const original=vault.current(),saved=vault.read(original);
 const id=randomUUID(),folder=join(directory,'save-profiles');mkdirSync(folder,{recursive:true,mode:0o700});
 // A profile owns its bytes. The active hunt prunes transient checkpoints, and
 // restoring a profile may advance that hunt again before the next restore.
 const archive=new SaveVault(join(folder,id),vault.identity);
 const source=archive.write(saved.state,saved.sram,saved.metadata);
 archive.pin(source);
 const record={id,label:context.label||'Saved game',createdAt:new Date().toISOString(),directory:archive.directory,activeDirectory:vault.directory,source,context};
 atomicJson(join(folder,id+'.json'),record);return record;
}
export function readGameProfile(directory,id,identity){
 if(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))throw Error('Choose a saved game backup.');
 const record=JSON.parse(readFileSync(join(directory,'save-profiles',id+'.json'),'utf8'));
 if(!resolve(record.directory).startsWith(resolve(directory)+'/'))throw Error('The backup does not belong to this game.');
 const activeDirectory=record.activeDirectory??record.directory;
 if(!resolve(activeDirectory).startsWith(resolve(directory)+'/'))throw Error('The active save does not belong to this game.');
 const archive=new SaveVault(record.directory,identity),saved=archive.read(record.source);
 const vault=new SaveVault(activeDirectory,identity);return {record,vault,saved};
}
