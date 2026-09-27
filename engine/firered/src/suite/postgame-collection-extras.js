import fame from './postgame-fame-facts.json' with {type:'json'};
import {postgameCaptureRequest} from './national-dex-agenda.js';
import {storageCapacity} from './storage-capacity.js';
import {fireRedPokemonCenter} from './fire-red-link-quest.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';

// Slot letters from src/wild_encounter.c at the pinned cartridge revision.
const CHAMBERS=[['MONEAN',[0,0,0,0,0,0,0,0,0,0,0,27]],['LIPTOO',[2,2,2,3,3,3,7,7,7,20,20,14]],['WEEPTH',[13,13,13,13,18,18,18,18,8,8,4,4]],['DILFORD',[15,15,11,11,9,9,17,17,17,16,16,16]],['SCUFIB',[24,24,19,19,6,6,6,5,5,5,10,10]],['RIXY',[21,21,21,22,22,22,23,23,12,12,1,1]],['VIAPOIS',[25,25,25,25,25,25,25,25,25,25,25,26]]];
const WEIGHTS=[20,20,10,10,10,10,5,5,4,4,1,1];
export const nativeUnownForms=map=>[...new Set(CHAMBERS.find(([name])=>map===`MAP_SEVEN_ISLAND_TANOBY_RUINS_${name}_CHAMBER`)?.[1]??[])];
export const fameRosterRestorationComplete=workflows=>!workflows?.fame?.cutRoster&&!workflows?.fame?.temporaryRoster;
export function selectUnownForm(o){
 const m=o.playerMemory,forms=m.postgameEvidence?.unownForms;
 if(!Array.isArray(forms)||m.storyState?.flagIds?.[2121]!==true||!storageCapacity(m.trainer).canStart)return null;
 const candidates=CHAMBERS.flatMap(([name,letters])=>[...new Set(letters)].filter(letter=>!forms.includes(letter)).map(letter=>({letter,map:`MAP_SEVEN_ISLAND_TANOBY_RUINS_${name}_CHAMBER`,chance:letters.reduce((n,l,i)=>n+(l===letter?WEIGHTS[i]:0),0)})));
 candidates.sort((a,b)=>Number(b.map===m.map.id)-Number(a.map===m.map.id)||b.chance-a.chance||a.letter-b.letter);
 const next=candidates[0];if(!next)return null;
 return {id:'postgame-unown-'+next.letter,target:{kind:'postgame-hunt'},route:{method:'wild-land',map:next.map,speciesId:201,nativeSpecies:201,unownForm:next.letter,name:'Unown '+('ABCDEFGHIJKLMNOPQRSTUVWXYZ!?')[next.letter]},request:postgameCaptureRequest(201)};
}

// Sources whose only approach crosses a Cut tree: the Celadon Gym yard (sign
// and every gym object) and the Pewter Museum annex behind Pewter's back door.
const cutGated=t=>t.map==='MAP_CELADON_CITY_GYM'||t.map==='MAP_CELADON_CITY'&&t.script==='CeladonCity_EventScript_GymSign'||
 t.map==='MAP_PEWTER_CITY_MUSEUM_1F'&&t.script==='PewterCity_Museum_1F_EventScript_PokemonJournalBrock';
export function selectFameChecker(o,world,state={},now=Date.now()){
 const records=o.playerMemory?.postgameEvidence?.fameChecker;
 if(!Array.isArray(records)||records.length!==16)return null;
 const m=o.playerMemory,trainer=m.trainer??{},party=trainer.party??[],stored=trainer.storage?.pokemon??[];
 const maps=(world.data??world).maps;
 const key=t=>t.map+':'+t.kind+':'+(t.index??'arrival');
 const roster=(id,requiredFingerprints,requiredMoveIds=[])=>({id,target:{kind:'party-roster',map:fireRedPokemonCenter(m.map.id),
  minimumPartySize:6,maximumPartySize:6,requiredFingerprints,requiredMoveIds},deferOptionalDetours:true,identityEvolution:true});
 // Legacy Cut checkpoints keep `cutRoster`; new conditional sources use the
 // same owned borrow/restore/save transaction under `temporaryRoster`.
 const borrowed=state.temporaryRoster??state.cutRoster,borrowedKey=state.temporaryRoster?'temporaryRoster':'cutRoster';
 if(borrowed){
  const source=fame.targets.find(t=>key(t)===borrowed.targetKey);
  const collected=source?.entries.every(([person,index])=>records[person].entries&(1<<index));
  const originalPresent=borrowed.original.every(fp=>party.some(p=>encounterFingerprint(p)===fp));
  if(collected){
   if(!originalPresent)return roster('postgame-fame-restore-roster',borrowed.original);
   const free=o.phase==='stable'&&o.emulator?.mode==='overworld'&&!o.emulator.inBattle&&
    !Object.values(m.ui??{}).some(Boolean);
   const save=borrowed.save??={};
   if(!save.linkSave){
    if(!free)return {id:'postgame-fame-restored-field',target:{kind:'map',map:m.map.id},deferOptionalDetours:true};
    if(!Number.isSafeInteger(m.gameStats?.savedGame)||!o.sram?.sha256)
     return {id:'postgame-fame-restore-save-unavailable',target:{kind:'stop-for-review',reason:'The restored Fame roster has no native save baseline.'}};
    save.linkSave={counter:m.gameStats.savedGame,sha256:o.sram.sha256};
   }
   const verified=m.saveAttemptStatus===1&&m.gameStats?.savedGame===save.linkSave.counter+1&&o.sram?.sha256!==save.linkSave.sha256;
   if(m.gameStats?.savedGame>save.linkSave.counter+1)
    return {id:'postgame-fame-restore-save-unverified',target:{kind:'stop-for-review',reason:'The restored Fame roster save counter changed unexpectedly.'}};
   if(!verified||!free)return {id:'postgame-fame-restore-save',target:{kind:'save-game',map:m.map.id,saveVerified:verified},dialogue:'advance',choice:'yes',identityEvolution:true,deferOptionalDetours:true};
   save.nativeLinkSave={nativeSaveVerified:true,savedSramSha256:o.sram.sha256,savedFrame:o.frame};
   delete state[borrowedKey];
   state.active=null;
  }else if(!party.some(p=>encounterFingerprint(p)===borrowed.carrier)){
   return roster(borrowedKey==='cutRoster'?'postgame-fame-cut-party':'postgame-fame-togetic-party',
    [borrowed.carrier],borrowed.requiredMoveIds??(borrowedKey==='cutRoster'?[15]:[]));
  }else state.active=borrowed.targetKey;
 }
 const candidates=fame.targets.filter(t=>{
  const map=maps.find(m=>m.id===t.map);if(!map)return false;
  // All nine cataloged map-arrival labels are empty native MapScripts; their
  // listed facts are awarded by object scripts on the same maps.
  if(t.kind==='map-arrival')return false;
  const targetKey=key(t);if(state.failed?.[targetKey]?.retryAt>now)return false;
  if(t.kind!=='map-arrival'){
   const events=t.kind==='object'?map.objectEvents:t.kind==='background'?map.backgroundEvents:map.coordEvents;
   if(events?.[t.index]?.script!==t.script)return false;
  }
  return t.entries.some(([person,index])=>!(records[person].entries&(1<<index)));
 });
 const selected=candidates.find(t=>key(t)===state.active)??candidates.sort((a,b)=>Number(b.map===o.playerMemory.map.id)-Number(a.map===o.playerMemory.map.id)||a.map.localeCompare(b.map))[0];
 if(!selected){state.active=null;return null;}
 state.active=key(selected);
 if(cutGated(selected)&&!party.some(p=>p.moves?.includes(15))){
  const carrier=stored.find(p=>p.validity==='valid'&&!p.isEgg&&p.moves?.includes(15));
  const original=party.map(encounterFingerprint);
  if(m.storyState?.flagIds?.[2081]!==true||!carrier||party.length!==6||original.some(fp=>!fp))
   return {id:'postgame-fame-cut-unavailable',target:{kind:'stop-for-review',reason:'This Fame source is behind a Cut tree. It requires the Cascade Badge and a verified Cut user in the party or PC.'}};
  state.cutRoster={targetKey:state.active,original,carrier:encounterFingerprint(carrier)};
  return roster('postgame-fame-cut-party',[state.cutRoster.carrier],[15]);
 }
 if(selected.script==='FiveIsland_WaterLabyrinth_EventScript_EggGentleman'){
  const ownsOriginal=p=>p.validity==='valid'&&!p.isEgg&&[175,176].includes(p.species)&&p.otId===trainer.otId;
  if(!party.some(ownsOriginal)){
   const carrier=stored.find(ownsOriginal),original=party.map(encounterFingerprint);
   if(m.storyState?.flagIds?.[730]!==true||!carrier||party.length!==6||original.some(fp=>!fp))
    return {id:'postgame-fame-togetic-unavailable',target:{kind:'stop-for-review',
     reason:'The Water Labyrinth Daisy fact requires the player\'s original Togepi or Togetic in the party.'}};
   state.temporaryRoster={targetKey:state.active,original,carrier:encounterFingerprint(carrier),kind:'original-togetic'};
   return roster('postgame-fame-togetic-party',[state.temporaryRoster.carrier]);
  }
 }
 return {id:'postgame-fame-'+state.active,target:{kind:selected.kind,map:selected.map,...(Number.isInteger(selected.index)?{index:selected.index}:{})},dialogue:'advance',choice:'no',deferOptionalDetours:true,identityEvolution:true};
}
