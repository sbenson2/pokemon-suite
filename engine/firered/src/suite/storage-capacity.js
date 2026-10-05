import {nationalDexNumbers} from '../evidence/gen3-national-species.js';
// Keep one box available for unexpected shinies, eggs and evolution transfers.
// Capacity is cartridge evidence; collection receipts are not an occupancy count.
export function assertCaptureCapacity(trainer,{quantity=1,protected:protectedEncounter=false}={}){
 if(protectedEncounter)return;
 const capacity=storageCapacity(trainer,{quantity});
 if(!capacity.canStart)throw Error(capacity.reason);
}
export function collectionStorage(trainer,{scope,records=[],quantity=0,caught=0}={}){
 const goal=scope==='postgame'?'national-dex':scope==='collection'?'shiny-national-dex':'current-task';
 const owned=scope==='postgame'?(Array.isArray(trainer?.pokedex?.ownedSpecies)?nationalDexNumbers(trainer.pokedex.ownedSpecies):undefined):
  records.filter(r=>r.owned&&r.nativeSaveVerified&&r.pokemon?.shiny===true&&Number.isInteger(r.nationalSpeciesId)&&r.nationalSpeciesId>=1&&r.nationalSpeciesId<=386).map(r=>r.nationalSpeciesId);
 const remainingTargets=goal==='current-task'?Math.max(0,quantity-caught):owned?386-new Set(owned).size:null;
 return {...storageCapacity(trainer,{remainingTargets:remainingTargets??0}),goal,remainingTargets};
}
export function storageCapacity(trainer,{remainingTargets=0,quantity=1,reserveSlots=30}={}){
 const counts=trainer?.storage?.boxCounts,party=trainer?.party;
 const known=trainer?.partyValidity==='valid'&&Array.isArray(party)&&party.length<=6&&
  trainer.storage?.validity==='valid'&&Array.isArray(counts)&&counts.length===14&&
  counts.every(n=>Number.isInteger(n)&&n>=0&&n<=30);
 if(!known)return {known:false,canStart:false,reserveSlots,reason:'Waiting for a verified count of party and PC space.'};
 const pcUsed=counts.reduce((a,b)=>a+b,0),partyUsed=party.length,used=pcUsed+partyUsed,free=426-used;
 const captureBudget=Math.max(0,free-reserveSlots),projectedUsed=used+Math.max(0,remainingTargets);
 return {known:true,pcUsed,pcCapacity:420,partyUsed,partyCapacity:6,used,capacity:426,free,pcFree:420-pcUsed,
  reserveSlots,captureBudget,projectedUsed,shortfall:Math.max(0,projectedUsed+reserveSlots-426),
  canStart:Number.isInteger(quantity)&&quantity>0&&captureBudget>=quantity,
  reason:captureBudget>=quantity?null:`${free} spaces remain. New captures wait to keep ${reserveSlots} spaces for unexpected shinies and transfers.`};
}
