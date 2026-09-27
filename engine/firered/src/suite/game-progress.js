import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {staticAvailability} from './static-availability.js';

export function fireRedProgress(o){
 if(!o)return null;
 const flag=id=>o.phase==='stable'&&typeof o.playerMemory?.storyState?.flagIds?.[id]==='boolean'?o.playerMemory.storyState.flagIds[id]:null;
 const gift=flag(611);
 return {game:'firered',frame:o.frame,leagueComplete:flag(2092),nationalDex:flag(2112),canLinkNationally:flag(2116),eeveeGiftAvailable:gift===null?null:!gift,ownedSpecies:o.playerMemory?.trainer?.pokedex?.ownedSpecies?.length??null,
  // Lets the host refuse a FireRed partner that shares this save's trainer ID.
  ...(Number.isInteger(o.playerMemory?.trainer?.trainerId)?{trainerId:o.playerMemory.trainer.trainerId}:{}),
  // One-time static encounters: used flag and the engine's story gates, so a
  // goal can choose this save, play the story first, or report the encounter used.
  statics:staticAvailability(o)};
}
export function emeraldProgress(o){
 const flag=name=>o.player?.map?.id?o.flag(name):null;
 return {game:'emerald',frame:o.frame,leagueComplete:flag('FLAG_SYS_GAME_CLEAR'),nationalDex:flag('FLAG_SYS_NATIONAL_DEX'),canLinkNationally:flag('FLAG_SYS_GAME_CLEAR'),badges:o.player?.map?.id?Array.from({length:8},(_,i)=>flag(`FLAG_BADGE0${i+1}_GET`)).filter(Boolean).length:null,ownedSpecies:o.player?.pokedex?.owned??null};
}
export async function createEmeraldProgressReader({researchBots,session}){
 const module=name=>import(pathToFileURL(join(researchBots,'games/emerald',name)));
 const [symbols,constantsModule,charmapModule,tablesModule,observations]=await Promise.all(['runtime-symbols.mjs','constants.mjs','text.mjs','rom-tables.mjs','observation.mjs'].map(module));
 const [manifest,constants,charmap]=await Promise.all([symbols.loadRuntimeManifest(),constantsModule.loadEmeraldConstants(),charmapModule.loadCharmap()]);
 const readMemory=(address,length)=>session.readMemory(address,length),tables=tablesModule.createRomTables({readMemory,manifest,charmap});
 const observer=observations.createEmeraldObserver({readMemory,manifest,constants,tables,charmap,frameOf:()=>session.frame});
 return ()=>emeraldProgress(observer.observe());
}
