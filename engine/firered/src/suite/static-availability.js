import {postgameEntryGates} from './postgame-gates.js';
import {SNORLAX_ROUTES,POKE_FLUTE_FLAG} from './snorlax-mission.js';

// One-time FireRed encounters the static mission executes. Each flag is the
// cartridge's FLAG_FOUGHT_<species>, set once the battle is resolved.
export const STATIC_ENCOUNTERS=[
 {speciesId:150,name:'Mewtwo',map:'MAP_CERULEAN_CAVE_B1F',script:'CeruleanCave_B1F_EventScript_Mewtwo',flag:700,level:70},
 {speciesId:144,name:'Articuno',map:'MAP_SEAFOAM_ISLANDS_B4F',script:'SeafoamIslands_B4F_EventScript_Articuno',flag:702,level:50},
 {speciesId:145,name:'Zapdos',map:'MAP_POWER_PLANT',script:'PowerPlant_EventScript_Zapdos',flag:703,level:50},
 {speciesId:146,name:'Moltres',map:'MAP_MT_EMBER_SUMMIT',script:'MtEmber_Summit_EventScript_Moltres',flag:701,level:50},
];

// Targets the postgame agenda can own on the current save. Requirements are
// the engine's own gates: the agenda's game-clear and Celio-link rules (the
// same rules that decide checklist eligibility) and each mission's own start
// checks. The engine automates these encounters only from post-League saves,
// so field access (Surf, Strength, the Sevii ferry) is covered by the League
// gate rather than guessed per route.
const gate=(g,source)=>({...g,source});
export const STATIC_TARGETS=Object.freeze([
 ...STATIC_ENCOUNTERS.map(e=>{const id=e.name.toLowerCase();return Object.freeze({id,speciesId:e.speciesId,name:e.name,method:'static',maps:[e.map],level:e.level,
  usedFlags:[e.flag],requires:postgameEntryGates(id).map(g=>gate(g,'postgame-agenda'))});}),
 Object.freeze({id:'snorlax',speciesId:143,name:'Snorlax',method:'snorlax',maps:SNORLAX_ROUTES.map(r=>r.map),level:30,
  // FLAG_HIDE_ROUTE_12/16_SNORLAX: the encounter is gone once both are set.
  usedFlags:SNORLAX_ROUTES.map(r=>r.flag),
  requires:[...postgameEntryGates('snorlax').map(g=>gate(g,'postgame-agenda')),{key:'pokeFlute',flag:POKE_FLUTE_FLAG,label:'Obtain the Poké Flute',need:'Poké Flute',source:'snorlax-mission'}]}),
]);

// Current-save availability for each target. Unreadable flags are unknown and
// never reported as available.
export function staticAvailability(o){
 const flags=o?.phase==='stable'?o.playerMemory?.storyState?.flagIds:null;
 const read=id=>typeof flags?.[id]==='boolean'?flags[id]:null;
 const owned=Array.isArray(o?.playerMemory?.trainer?.pokedex?.ownedSpecies)?new Set(o.playerMemory.trainer.pokedex.ownedSpecies):null;
 return STATIC_TARGETS.map(t=>{
  const states=t.usedFlags.map(read),used=states.every(v=>v===true)?true:states.some(v=>v===false)?false:null;
  const requirements=t.requires.map(({source,...r})=>({...r,met:read(r.flag)}));
  const missing=requirements.filter(r=>r.met===false).map(r=>r.need),unknown=requirements.some(r=>r.met===null);
  const available=used===true?false:used===false&&missing.length?false:used===false&&!unknown?true:null;
  const status=used===true?'used':used===null?'unknown':missing.length?'needs-prerequisites':unknown?'unknown':'available';
  return {id:t.id,speciesId:t.speciesId,name:t.name,method:t.method,map:t.maps[0],level:t.level,used,owned:owned?owned.has(t.speciesId):null,available,status,requirements,missing};
 });
}
export const staticTarget=value=>STATIC_TARGETS.find(t=>t.id===value||t.speciesId===value)??null;
