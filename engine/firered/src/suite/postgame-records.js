import {selectOwnedBreeding} from './native-breeding.js';
import {storageCapacity} from './storage-capacity.js';
import {saveFireRedQuestMilestone} from './fire-red-link-quest.js';

// Native thresholds and menu order: data/scripts/trainer_card.inc.
const RECORDS={
 'hall-sticker':{counter:'leagueEntries',variable:0x4049,thresholds:[1,40,100,200],label:'Hall of Fame sticker'},
 'egg-sticker':{counter:'eggsHatched',variable:0x404a,thresholds:[1,100,200,300],label:'Egg sticker'},
};
export const recordSaveStates=workflows=>Object.values(workflows?.records??{}).map(s=>s.claim?.save).filter(Boolean);
export const pendingRecordClaim=workflows=>Object.entries(workflows?.records??{}).find(([,s])=>s.claim&&!s.claim.save?.nativeLinkSave)?.[0]??null;
export function eggRecordNeedsSpace(o,workflows){
 const count=o.playerMemory?.gameStats?.eggsHatched,value=o.playerMemory?.storyState?.variableIds?.[0x404a];
 return Number.isSafeInteger(count)&&count<300&&Number.isInteger(value)&&
  RECORDS['egg-sticker'].thresholds.filter(n=>count>=n).length<=value&&!workflows?.records?.['egg-sticker']?.claim;
}
export function recordComplete(id,o,workflows){
 const value=o.playerMemory?.storyState?.variableIds?.[RECORDS[id].variable];
 return Number.isInteger(value)?value>=4&&!(workflows?.records?.[id]?.claim&&!workflows.records[id].claim.save?.nativeLinkSave):undefined;
}
export function observeLeagueReceipt(o,s){
 const m=o.playerMemory??{};
 if(!s?.baseline||s.receipt)return;
 const verified=m.storyState?.flagIds?.[2116]===true&&m.gameStats?.leagueEntries>s.baseline.leagueEntries&&m.gameStats?.savedGame>s.baseline.savedGame&&o.sram?.sha256&&o.sram.sha256!==s.baseline.sha256;
 if(o.emulator?.callback2==='CB2_HofIdle'&&verified)s.hallOfFame={frame:o.frame,sha256:o.sram.sha256,leagueEntries:m.gameStats.leagueEntries,savedGame:m.gameStats.savedGame};
 if(s.hallOfFame&&verified&&o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!m.questLog?.playback&&!Object.values(m.ui??{}).some(Boolean))s.receipt={nativeSaveVerified:true,savedSramSha256:o.sram.sha256,frame:o.frame,leagueEntries:m.gameStats.leagueEntries,savedGame:m.gameStats.savedGame};
}

export function resolvePostgameRecord(id,o,world,workflows,context,league){
 const rule=RECORDS[id];if(!rule)return undefined;
 const m=o.playerMemory,count=m.gameStats?.[rule.counter],value=m.storyState?.variableIds?.[rule.variable];
 const objective=(suffix,target,extra={})=>({id:`postgame-${id}-${suffix}`,target,dialogue:'advance',choice:'yes',identityEvolution:true,deferOptionalDetours:true,...extra});
 const stop=reason=>objective('dependency',{kind:'stop-for-review',reason});
 if(!Number.isSafeInteger(count)||count<0||!Number.isInteger(value)||value<0||value>4)return stop(`The native ${rule.label} counter and claimed level must be readable.`);
 const s=(workflows.records??={})[id]??={};
 const tier=rule.thresholds.filter(n=>count>=n).length;
 if(value>tier)return stop(`The ${rule.label} level is inconsistent with its native counter.`);
 if(s.cycle?.receipt){s.lastRun=s.cycle.receipt;delete s.cycle;}
 if(!s.claim&&tier>value)s.claim={tier,save:{}};
 if(s.claim){
  if(value>=s.claim.tier){
   const saved=saveFireRedQuestMilestone(o,s.claim.save,{variableId:rule.variable,minimumValue:s.claim.tier,id:`postgame-${id}-save`,label:rule.label});
   if(saved.kind==='policy')return saved.objective;
   if(saved.kind==='stop')return stop(saved.reason);
   (s.receipts??=[]).push({...saved.receipt,tier:s.claim.tier,count});delete s.claim;
  }else{
   const map='MAP_FOUR_ISLAND_HOUSE2',index=(world.data??world).maps.find(m=>m.id===map)?.objectEvents?.findIndex(e=>e.script==='FourIsland_House2_EventScript_StickerMan')??-1;
   if(index<0)return stop('The native Sticker Man interaction is unavailable.');
   // Egg is after Hall of Fame only when that category has a nonzero count.
   const choice=id==='hall-sticker'?0:Number(m.gameStats?.leagueEntries>0);
   return objective('claim',{kind:'object',map,index},{choiceByRows:{2:0,3:choice,4:choice}});
  }
 }
 if(value===4)return null;
 if(id==='hall-sticker'){
  if(!s.cycle){
   if(!Number.isSafeInteger(m.gameStats?.savedGame)||!o.sram?.sha256)return stop('The next League run needs a verified native save baseline.');
   s.cycle={baseline:{leagueEntries:count,savedGame:m.gameStats.savedGame,sha256:o.sram.sha256}};
  }
  return league();
 }
 const space=storageCapacity(m.trainer);if(!space.canStart)return stop(space.reason);
 const breeding=context.mechanics?selectOwnedBreeding({trainer:m.trainer,mechanics:context.mechanics,protectedFingerprints:context.protectedFingerprints??[],allowOwned:true}):null;
 if(!breeding)return stop('The Egg record needs two compatible spare non-shiny parents outside the active party.');
 return objective('hatch-'+count,{kind:'postgame-acquire'},{acquisition:{kind:'breeding',...breeding}});
}
