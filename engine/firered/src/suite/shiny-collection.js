import {createHash} from 'node:crypto';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
const ownership=o=>{
 const t=o?.playerMemory?.trainer;
 return t?.partyValidity==='valid'&&t.storage?.validity==='valid'?[...(t.party??[]).map(p=>({...p,location:`Party slot ${p.slot+1}`})),...(t.storage.pokemon??[]).map(p=>({...p,location:`Box ${p.box+1}, slot ${p.slot+1}`}))]:null;
};
const lineage=p=>{
 const ivs=['hp','attack','defense','speed','spAttack','spDefense'].map(k=>p?.ivs?.[k]);
 return p?.validity==='valid'&&Number.isInteger(p.personality)&&Number.isInteger(p.otId)&&ivs.every(Number.isInteger)?JSON.stringify([p.personality,p.otId,...ivs]):null;
};
function evolved(record,pokemon,observation){
 record.evolution={fromSpecies:record.pokemon.species,toSpecies:pokemon.species,originalFingerprint:record.fingerprint,saveCounter:observation.playerMemory.gameStats?.savedGame??null,sramSha256:observation.sram?.sha256??null};
 record.fingerprint=encounterFingerprint(pokemon);record.pokemon={...record.pokemon,...pokemon};record.nativeSaveVerified=false;
}
export function updateShinyCollection({game,records=[],capture,requestId,observation,trade,now=new Date().toISOString()}){
 const result=structuredClone(records);
 if(capture?.nativeSaveVerified&&capture.pokemon?.shiny&&capture.fingerprint===encounterFingerprint(capture.pokemon)){
  const id=createHash('sha256').update(game+':'+capture.fingerprint).digest('hex');
  if(!result.some(r=>r.id===id))result.push({id,game,requestId,fingerprint:capture.fingerprint,pokemon:structuredClone(capture.pokemon),traits:capture.traits??null,nativeSaveVerified:true,savedSramSha256:capture.savedSramSha256,caughtAt:now,state:'saved'});
 }
 const all=ownership(observation);
 for(const record of result){
  if(all){
   let matches=all.filter(p=>encounterFingerprint(p)===record.fingerprint);
   if(matches.length===0){
    const key=lineage(record.pokemon),family=key?all.filter(p=>p.shiny&&lineage(p)===key):[];
    // Nincada legitimately produces two records, retaining the same PID/OT/IVs.
    // These are native Gen III species IDs, not National Pokédex numbers.
    if(record.pokemon.species===301&&family.length===2&&family.some(p=>p.species===302)&&family.some(p=>p.species===303)){
     const shedinja=family.find(p=>p.species===303),bonus=structuredClone(record);
     bonus.id=createHash('sha256').update(game+':'+encounterFingerprint(shedinja)).digest('hex');bonus.derivedFrom=record.id;
     evolved(bonus,shedinja,observation);
     if(!result.some(r=>r.id===bonus.id))result.push(bonus);
     matches=[family.find(p=>p.species===302)];evolved(record,matches[0],observation);
    }else if(family.length===1){matches=family;evolved(record,matches[0],observation);}
    else if(family.length>1)matches=family;
   }
   record.owned=matches.length===1;record.location=record.owned?matches[0].location:null;
   record.state=matches.length>1?'identity-conflict':record.owned?'saved':record.state==='traded'?'traded':'not-in-current-save';
   if(record.owned)record.pokemon={...record.pokemon,...matches[0]};
   if(record.owned&&record.evolution&&!record.nativeSaveVerified){
    const proof=record.evolution,m=observation.playerMemory;
    if(Number.isInteger(proof.saveCounter)&&proof.sramSha256&&m.saveAttemptStatus===1&&m.gameStats?.savedGame>proof.saveCounter&&observation.sram?.sha256&&observation.sram.sha256!==proof.sramSha256){record.nativeSaveVerified=true;record.savedSramSha256=observation.sram.sha256;proof.nativeSaveVerified=true;}
    else record.state='evolution-awaiting-save';
   }
  }else record.owned=null;
  if(trade?.fingerprint===record.fingerprint&&trade.completion?.nativeSaveVerified&&!record.owned){record.state='traded';record.tradedAt??=now;}
  record.nationalSpeciesId=game==='crystal'?record.pokemon.species:nationalSpeciesId(record.pokemon.species);
 }
 return result;
}
export function selectShinyForTrade({records,id,observation,trade}){
 if(trade?.exchangeStarted&&!trade.completion?.nativeSaveVerified)throw new Error('The previous exchange must be resolved before selecting another Pokémon');
 const record=records.find(r=>r.id===id),all=ownership(observation);
 if(!record?.nativeSaveVerified||!record.pokemon?.shiny||record.state==='traded')throw new Error('Select a saved shiny from this game');
 if(!all||all.filter(p=>encounterFingerprint(p)===record.fingerprint).length!==1)throw new Error('The selected shiny is missing, duplicated, or unreadable in this game');
 return record;
}
