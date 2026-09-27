import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function navigationRecoveryProgress(cycle,watch,o){
 if(cycle.type==='stationary'&&o.phase==='stable'&&o.emulator?.mode==='overworld'&&o.playerMemory?.position&&JSON.stringify(o.playerMemory.position)!==JSON.stringify(cycle.position))return true;
 return !cycle.pattern.includes(o.playerMemory?.map?.id)||Boolean(watch?.progress&&watch.progress!==cycle.progress);
}

// Map crossings are movement, but are not evidence of completing an errand.
// Persist this small observation history in the mission's normal checkpoint.
export function observeNavigationCycle({observation:o,objective,state,now=Date.now()}){
 const m=o?.playerMemory,t=m?.trainer;
 if(!objective?.target?.map||o.phase!=='stable'||o.emulator?.mode!=='overworld'||o.emulator.inBattle||!m.map?.id||Object.values(m.ui??{}).some(Boolean)||t?.partyValidity!=='valid'){state.stationary=null;return null;}
 const key=JSON.stringify([objective.id,objective.target]);
 // Battles encountered while walking are not progress toward the destination.
 // Only the active errand's economy/recovery state may reset this history.
 const recovery=objective.taskKind==='recovery'||/^(restore-|recover-)|heal/.test(objective.id??'');
 const supplies=objective.target.kind==='purchase-items';
 const progress=digest({
  ...(supplies||recovery?{money:t.money,bag:t.bag}:{}),
  owned:t.pokedex?.ownedSpecies,storageCount:t.storage?.pokemon?.length,savedGame:m.gameStats?.savedGame,
  storyFlags:m.storyState?.flagIds,
  storyVariables:Object.fromEntries(Object.entries(m.storyState?.variableIds??{}).filter(([id])=>Number(id)>=0x4010)),
  party:t.party?.map(p=>recovery?[p.personality,p.species,p.hp,p.status1,p.pp]:[p.personality,p.species]),
 });
 if(state.objective!==key||state.progress!==progress){Object.assign(state,{objective:key,progress,since:now,maps:[],cycle:null,stationary:null});}
 if(state.cycle)return state.cycle;
 if(state.maps.at(-1)!==m.map.id)state.maps=[...state.maps,m.map.id].slice(-36);
 if(Number.isInteger(m.position?.x)&&Number.isInteger(m.position?.y)){
  const location=JSON.stringify([m.map.id,m.position.x,m.position.y]);
  if(state.stationary?.location!==location)state.stationary={location,since:now};
  if(now-state.stationary.since>=60000)return state.cycle={reason:'repeated-navigation-cycle',type:'stationary',objective:key,progress,pattern:[m.map.id],position:{...m.position},since:state.stationary.since,detectedAt:now};
 }
 if(now-state.since<60000)return null;
 for(let period=2;period<=6;period++){
  const tail=state.maps.slice(-period*3);
  if(tail.length!==period*3||new Set(tail).size<2)continue;
  if(tail.every((map,i)=>map===tail[i%period]))return state.cycle={reason:'repeated-navigation-cycle',objective:key,progress,pattern:tail.slice(-period),repeats:3,since:state.since,detectedAt:now};
 }
 return null;
}
