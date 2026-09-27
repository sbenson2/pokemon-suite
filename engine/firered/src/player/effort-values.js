import {IV_STATS} from '../evidence/pokemon-record.js';
const yields={hp:'HP',attack:'Attack',defense:'Defense',speed:'Speed',spAttack:'SpAttack',spDefense:'SpDefense'};
export function validateEffortRequest(request) {
  if(typeof request.fingerprint!=='string'||!request.fingerprint||!request.evs||Object.keys(request.evs).length!==6||
    IV_STATS.some(k=>!Number.isInteger(request.evs[k])||request.evs[k]<0||request.evs[k]>255)||
    Object.values(request.evs).reduce((a,b)=>a+b,0)>510)throw new TypeError('Choose all six EV targets, at most 255 each and 510 total.');
  if(!request.ivRanges||typeof request.ivRanges!=='object'||Array.isArray(request.ivRanges)||Object.entries(request.ivRanges).some(([k,r])=>
    !IV_STATS.includes(k)||!r||Object.keys(r).sort().join(',')!=='max,min'||!Number.isInteger(r.min)||!Number.isInteger(r.max)||r.min<0||r.max>31||r.min>r.max))throw new TypeError('Choose IV ranges from 0 to 31.');
}
// pokefirered c75f3523 pokemon.c:MonGainEVs. EVs are not divided between
// participants or Exp. Share recipients; the per-recipient multipliers apply.
export function effortGain(member,species) {
  if(!Number.isInteger(member?.pokerus)||!member.evs||!species||IV_STATS.some(k=>!Number.isInteger(species['evYield_'+yields[k]])))return null;
  if(member.heldItem===175)return null; // Enigma Berry's custom hold effect is unknown.
  const multiplier=(member.pokerus!==0?2:1)*(member.heldItem===181?2:1);
  let total=IV_STATS.reduce((sum,k)=>sum+member.evs[k],0);
  return Object.fromEntries(IV_STATS.map(k=>{
    const gain=member.level>=100?0:Math.max(0,Math.min(species['evYield_'+yields[k]]*multiplier,255-member.evs[k],510-total));
    total+=gain;return [k,gain];
  }));
}
export function acceptableEffortGain(member,species,target) {
  const gain=effortGain(member,species);
  return gain&&Object.values(gain).some(n=>n>0)&&IV_STATS.every(k=>member.evs[k]+gain[k]<=target[k])?gain:null;
}
