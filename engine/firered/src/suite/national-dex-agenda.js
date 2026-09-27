import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
import {nationalDexProgress} from './postgame-progress.js';
import {storageCapacity} from './storage-capacity.js';
import evolutionRules from './fire-red-evolution-rules.json' with {type:'json'};
import {campaignTargetReachable} from '../player/campaign.js';
import {fireRedIsland,fireRedFerryArrival} from './fire-red-link-quest.js';

const sourceCache=new WeakMap();
function cartridgeSources(world,mechanics){
 if(sourceCache.has(world))return sourceCache.get(world);
 const species=new Map((mechanics.data??mechanics).species.map(s=>[s.name,nationalSpeciesId(s.id)])),sources=new Map();
 for(const table of (world.data??world).wildEncounters??[]){
  if(!table.base_label?.endsWith('_FireRed'))continue;
  for(const [key,method] of [['land_mons',table.map.startsWith('MAP_SAFARI_ZONE_')?'safari-land':'wild-land'],['water_mons','surf'],['fishing_mons','fishing'],['rock_smash_mons','rock-smash']]){
   for(const slot of table[key]?.mons??[]){const id=species.get(slot.species);if(id){const list=sources.get(id)??[];if(!list.some(r=>r.map===table.map&&r.method===method))list.push({map:table.map,method});sources.set(id,list);}}
  }
 }
 sourceCache.set(world,sources);return sources;
}
export function nationalDexSources({o,world,mechanics}){
 const t=o.playerMemory?.trainer??{},flags=o.playerMemory?.storyState?.flagIds??{},dex=nationalDexProgress(t.pokedex?.ownedSpecies);
 const missing=new Set(dex.missing),sources=cartridgeSources(world,mechanics),rules=evolutionRules.rules;
 const names=new Map((mechanics.data??mechanics).species.map(s=>[nationalSpeciesId(s.id),s.name.replace('SPECIES_','').toLowerCase()]));
 const giftFlags={131:582,133:611,142:750,138:749,140:748,175:730};
 return Array.from({length:386},(_,i)=>{
  const speciesId=i+1,name=names.get(speciesId)??`#${speciesId}`;
  const row=(method,status,reason,extra={})=>({speciesId,name,method,status,reason,...extra});
  if(dex.known&&!missing.has(speciesId))return row('owned','complete','Registered as caught in this save.');
  const wild=sources.get(speciesId);if(wild?.length)return row(wild[0].method,'local','Acquire from this cartridge’s native encounter table.',{locations:wild});
  if([151,251,385].includes(speciesId))return row('event-source','external','Requires a legitimately acquired Pokémon from a compatible external source.');
  if([249,250,386].includes(speciesId))return row('event-source','external','Requires the appropriate legitimate event ticket and encounter, or a compatible trade.');
  const rule=rules.find(r=>r.speciesId===speciesId);
  if(rule)return row(rule.trigger==='trade'?'trade-evolution':rule.evolutionGame||rule.beauty?'partner-evolution':'evolution',rule.trigger==='trade'||rule.evolutionGame||rule.beauty?'external':'local',
   rule.trigger==='trade'?'Reserve the original individual, trade with a compatible independent save, verify evolution, and trade it back.':rule.evolutionGame||rule.beauty?'Evolve in a compatible partner game and return the same individual.':'Acquire the previous form and perform its native evolution.',{fromSpecies:rule.fromSpecies,requirements:rule});
  if(Object.hasOwn(giftFlags,speciesId))return row('gift',flags[giftFlags[speciesId]]===false?'local':'dependency',flags[giftFlags[speciesId]]===false?'A native gift or fossil revival remains; verify its prerequisites.':'Check an owned ancestor, native breeding, or a compatible partner; this gift is already used or unreadable.');
  if([144,145,146,150,143,243,244,245].includes(speciesId))return row('static-or-roamer','dependency','Verify this save’s remaining encounter; exhausted encounters and the other two roaming species need a partner.');
  const childOf=rules.filter(r=>r.fromSpecies===speciesId).map(r=>r.speciesId);
  if(childOf.some(id=>!missing.has(id)))return row('breeding','dependency','An evolved family member is registered. Verify compatible owned parents and breed a native Egg.',{family:childOf});
  return row('partner-source','external','Requires another starter, version, generation III game, native breeding source, or compatible trade.');
 });
}

export function postgameCaptureRequest(speciesId,{shiny='any',locationId='any'}={}){
 return {schema:'pokemon-suite/farming-request/v1',game:'firered',speciesId,quantity:1,locationId,shiny,natures:[],gender:'any',abilityId:null,
  ball:{id:'any',requirement:'preferred'},minIvs:{},minDvs:{},encounterLevel:{min:1,max:100},finalLevel:null,moves:[],heldItemId:null,
  limits:{maxEncounters:10000,maxMinutes:120,minBalls:10,maxSpend:999999},afterCompletion:'stop-save'};
}

const WEIGHTS=[20,20,10,10,10,10,5,5,4,4,1,1];
// Altering Cave has nine FireRed tables in cartridge order, and the game uses
// only the one VAR_ALTERING_CAVE_WILD_SET selects (src/wild_encounter.c
// GetCurrentMapWildMonHeaderId). 0, unset, or out of range means table 1.
export const ALTERING_CAVE_WILD_SET=0x4024;
const inactiveAlteringCaveTable=(table,variables)=>{
 const match=table.map==='MAP_SIX_ISLAND_ALTERING_CAVE'&&/AlteringCave(?:_(\d+))?_FireRed$/.exec(table.base_label);
 if(!match)return false;
 const value=Number(variables?.[ALTERING_CAVE_WILD_SET]);
 return Number(match[1]??1)-1!==(Number.isInteger(value)&&value>=0&&value<9?value:0);
};
export function selectNationalDexCapture({o,world,mechanics,state={},now=Date.now()}){
 const m=o.playerMemory??{},f=m.storyState?.flagIds??{},dex=nationalDexProgress(m.trainer?.pokedex?.ownedSpecies);
 if(o.phase!=='stable'||!dex.known||f[2092]!==true||f[2112]!==true||f[2116]!==true||!storageCapacity(m.trainer).canStart)return null;
 const missing=new Set(dex.missing),species=new Map((mechanics.data??mechanics).species.map(s=>[s.name,s.id])),candidates=[];
 for(const table of (world.data??world).wildEncounters??[]){
  if(!table.base_label?.endsWith('_FireRed')||!table.land_mons?.mons?.length)continue;
  if(table.map.includes('TANOBY_RUINS')&&f[2121]!==true)continue;
  if(inactiveAlteringCaveTable(table,m.storyState?.variableIds))continue;
  const shares=new Map();
  for(const [i,slot] of table.land_mons.mons.entries()){
   const nativeSpecies=species.get(slot.species),id=nationalSpeciesId(nativeSpecies);
   if(!id||!missing.has(id)||state.failed?.[id]?.retryAt>now||state.failed?.[`${id}:${table.map}`]?.retryAt>now)continue;
   shares.set(nativeSpecies,(shares.get(nativeSpecies)??0)+(WEIGHTS[i]??0));
  }
  for(const [nativeSpecies,share] of shares){
   const speciesId=nationalSpeciesId(nativeSpecies),safari=table.map.startsWith('MAP_SAFARI_ZONE_');
   candidates.push({speciesId,nativeSpecies,map:table.map,method:safari?'safari-land':'wild-land',share,
    weight:share*table.land_mons.encounter_rate,here:table.map===m.map?.id,
    name:(mechanics.data??mechanics).species.find(s=>s.id===nativeSpecies).name.replace('SPECIES_','').toLowerCase()});
  }
 }
 // Hunt only a table navigation can reach. A trip starts here on the same
 // island; the island's ferry landing also counts (the cross-island start,
 // and a Kanto Fly/ferry detour out of a walled-off pocket such as Indigo
 // Plateau). Unknown maps stay eligible; the hunt's own route owns them.
 const reachable=new Map(),canReach=c=>{
  if(!reachable.has(c.map))reachable.set(c.map,campaignTargetReachable({world,observation:o,target:{kind:'encounter-zone',map:c.map},exact:true,
   origins:[...(fireRedIsland(c.map)===fireRedIsland(m.map?.id)&&m.position?[{map:m.map.id,position:m.position}]:[]),fireRedFerryArrival(c.map)]})!==false);
  return reachable.get(c.map);
 };
 const retained=candidates.find(c=>c.speciesId===state.target?.speciesId&&c.map===state.target.map&&canReach(c));
 const chosen=retained??candidates.sort((a,b)=>Number(b.here)-Number(a.here)||b.weight-a.weight||a.speciesId-b.speciesId||a.map.localeCompare(b.map)).find(canReach);
 if(!chosen){state.target=null;return null;}
 state.target={speciesId:chosen.speciesId,map:chosen.map};
 return {id:'postgame-national-catch-'+chosen.speciesId,target:{kind:'postgame-hunt'},route:chosen,request:postgameCaptureRequest(chosen.speciesId)};
}
