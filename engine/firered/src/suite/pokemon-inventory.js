import {createHash} from 'node:crypto';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';

// A view of owned individuals, never a list of historical encounter receipts.
export function pokemonInventory(game,trainer){
 const readable=trainer?.partyValidity==='valid'&&trainer.storage?.validity==='valid';
 const boxes=Array.from({length:14},(_,box)=>({box,name:`Box ${box+1}`,capacity:30,used:readable?trainer.storage.boxCounts?.[box]??0:null}));
 if(!readable)return {validity:'unknown',reason:'The party and PC could not both be read reliably.',pokemon:[],boxes};
 const members=[...(trainer.party??[]).map(p=>({pokemon:p,location:{kind:'party',slot:p.slot}})),
  ...(trainer.storage.pokemon??[]).map(p=>({pokemon:p,location:{kind:'box',box:p.box,slot:p.slot}}))];
 const records=members.map(({pokemon:p,location})=>{
  const fingerprint=encounterFingerprint(p);
  return {...p,id:createHash('sha256').update(game+':'+fingerprint).digest('hex'),
   fingerprint,nationalSpeciesId:game==='crystal'?p.species:nationalSpeciesId(p.species),location};
 });
 const counts=new Map();for(const p of records)counts.set(p.id,(counts.get(p.id)??0)+1);
 return {validity:'valid',currentBox:trainer.storage.currentBox,boxes,
  pokemon:records.map(p=>({...p,identityConflict:counts.get(p.id)!==1,
   slotId:p.location.kind==='party'?`party:${p.slot}`:`box:${p.box}:${p.slot}`}))};
}
export function selectInventoryPokemon(game,trainer,id){
 const inventory=pokemonInventory(game,trainer);
 if(inventory.validity!=='valid')throw Error('The current party and PC must be readable before trading.');
 const matches=inventory.pokemon.filter(p=>p.id===id);
 if(matches.length!==1)throw Error('The selected Pokémon is missing or duplicated in this save.');
 const mon=matches[0];
 if(mon.isEgg)throw Error('Egg trading is not qualified for this wireless route.');
 if(!mon.fingerprint||!Number.isInteger(mon.personality)||!Number.isInteger(mon.otId)||
  !['hp','attack','defense','speed','spAttack','spDefense'].every(key=>Number.isInteger(mon.ivs?.[key])))throw Error('The selected Pokémon identity could not be read.');
 return mon;
}
