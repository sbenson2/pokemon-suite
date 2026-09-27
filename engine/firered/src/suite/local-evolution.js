import rules from './fire-red-evolution-rules.json' with {type:'json'};
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';

const ivs=['hp','attack','defense','speed','spAttack','spDefense'];
const identified=p=>p?.validity==='valid'&&Number.isInteger(p.personality)&&Number.isInteger(p.otId)&&ivs.every(k=>Number.isInteger(p.ivs?.[k]));
export const sameEvolutionIndividual=(a,b)=>identified(a)&&identified(b)&&a.personality===b.personality&&a.otId===b.otId&&ivs.every(k=>a.ivs[k]===b.ivs[k])&&(!a.shiny||b.shiny===true);
const getRule=(from,to)=>rules.rules.find(r=>r.fromSpecies===from&&r.speciesId===to);
const OWNER=/^[a-zA-Z0-9_-]{1,100}$/;
// A pair has two roles. The source owner coordinates and receives the evolved
// individual back; the partner owner serves the round trip. Reservations made
// before roles existed are the FireRed source with the Emerald companion.
export const LEGACY_PAIR_ROLES=Object.freeze({source:Object.freeze({owner:'firered',title:'firered',trainerId:null}),partner:Object.freeze({owner:'emerald',title:'emerald',trainerId:null})});
export const pairRoles=reservation=>reservation?.roles??LEGACY_PAIR_ROLES;
// Receipts and restart proofs are keyed by role. Legacy FireRed–Emerald ones
// may still be keyed by title; two FireRed owners can only be told apart by role.
const byRole=(values,roles,role)=>values?.[role]??(roles.source.title!==roles.partner.title?values?.[roles[role].title]:undefined);
const ownedBy=(value,roles,role)=>value?.game===roles[role].title&&(value.owner===undefined&&value.role===undefined?roles[role].owner===roles[role].title:value.owner===roles[role].owner&&value.role===role);
export const keyedByRole=(reservation,source,partner)=>reservation?.roles?{source,partner}:{firered:source,emerald:partner};

// Only a cold boot of this owner's unchanged SRAM can supply this evidence.
// A received party, changed counter, or ambiguous save must never be retraded.
export function proveUncommittedLocalTrade({game,role,owner,state,observation:o,wireless:w,sramSha256}){
 const trade=state?.trade,m=o?.playerMemory,party=m?.trainer?.party?.map(encounterFingerprint);
 if(!state?.requestId||!state.pairId||!['outbound','return'].includes(state.leg)||!/^[a-f0-9]{64}$/.test(sramSha256??''))throw Error('The native trade restart identity is unavailable.');
 if(o.emulator?.callback2!=='CB2_Overworld'||o.emulator.paletteFadeActive||m?.scripts?.fieldControlsLocked||m?.map?.id!==trade?.map||w?.remotePlayers!==0)throw Error('The native link did not restart in its disconnected Pokémon Center.');
 if(m?.trainer?.partyValidity!=='valid'||!trade?.partyBefore?.length||JSON.stringify(party)!==JSON.stringify(trade.partyBefore))throw Error('The native party differs from the original trade party. Preserve both owners for reconciliation.');
 if(!Number.isSafeInteger(trade.tradeCountBefore)||w.tradeCount!==trade.tradeCountBefore)throw Error('The native trade counter changed. The exchange must not be repeated.');
 return {game,...(role?{role,owner}:{}),requestId:state.requestId,pairId:state.pairId,leg:state.leg,outcome:'not-committed',nativeSaveVerified:true,savedSramSha256:sramSha256,tradeCount:w.tradeCount,party};
}

export function verifyLocalTradeRestart(pair,proofs){
 if((pair?.restarts??0)>=3)throw Error('The local exchange reached three verified retries. Preserve both games for repair.');
 const roles=pairRoles(pair?.reservation);
 for(const role of ['source','partner']){
  const p=byRole(proofs,roles,role);
  if(!p||!ownedBy(p,roles,role)||p.requestId!==pair?.requestId||p.pairId!==pair.pairId||p.leg!==pair.leg||p.outcome!=='not-committed'||p.nativeSaveVerified!==true||!/^[a-f0-9]{64}$/.test(p.savedSramSha256??''))throw Error('Both native owners must prove the same uncommitted pair before retrying.');
 }
 return true;
}
const hm=new Set([15,19,57,70,127,148,249,291]);
export function selectLocalTradePartner(party){
 return party.find(p=>identified(p)&&p.shiny===false&&!p.isEgg&&!(p.moves??[]).some(m=>hm.has(typeof m==='number'?m:m.id))&&!rules.rules.some(r=>r.fromSpecies===nationalSpeciesId(p.species)&&r.trigger==='trade'&&(!r.heldItem||r.heldItem.nativeId===p.heldItem)))??null;
}

// The invisible FireRed partner offers only an ordinary Pokémon of its own:
// never a shiny, legendary or mythical, egg, item holder, HM carrier or a
// Pokémon that would itself evolve by trade. It stays within #1–151 so a
// source save without the National Pokédex can still receive it.
const LEGENDARY_OR_MYTHICAL=new Set([144,145,146,150,151,243,244,245,249,250,251,377,378,379,380,381,382,383,384,385,386]);
export function selectPartnerPlaceholder(party){
 return (party??[]).find(p=>{
  const species=nationalSpeciesId(p?.species);
  return identified(p)&&p.shiny===false&&p.isEgg===false&&p.heldItem===0&&Number.isInteger(species)&&species<=151&&!LEGENDARY_OR_MYTHICAL.has(species)&&selectLocalTradePartner([p])===p;
 })??null;
}
// The partner's individuals before a round trip; afterwards it must hold
// exactly the same ones again (its placeholder back, nothing kept).
export function partnerHoldings(trainer){
 if(trainer?.partyValidity!=='valid'||trainer.storage?.validity!=='valid'||!Array.isArray(trainer.party)||!Array.isArray(trainer.storage.pokemon))throw Error('The partner party and PC could not be verified.');
 const list=pokemon=>pokemon.map(encounterFingerprint).sort();
 if([...trainer.party,...trainer.storage.pokemon].some(p=>!encounterFingerprint(p)))throw Error('The partner party and PC could not be verified.');
 return {party:list(trainer.party),storage:list(trainer.storage.pokemon)};
}
export function verifyPartnerNetZero(before,trainer){
 const after=partnerHoldings(trainer);
 if(!Array.isArray(before?.party)||!Array.isArray(before?.storage)||JSON.stringify(after)!==JSON.stringify(before))throw Error('The partner does not hold exactly its original Pokémon after the round trip. Its save is preserved for review; the net-zero exchange is not verified.');
 return true;
}

export function reserveLocalEvolution({evolution:e,source,partner,sourceOwner='firered',sourceTrainerId=null,partnerTrainerId=null}){
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(e?.requestId??'')||!Number.isInteger(e.index)||!identified(source)||source.isEgg)throw Error('The saved evolution source is not identified.');
 const start=e.steps[e.index],partnerOwner=start?.partner??'emerald',partnerTitle=start?.toGame;
 const roles=start?.partner===undefined?LEGACY_PAIR_ROLES:{source:{owner:sourceOwner,title:'firered',trainerId:sourceTrainerId},partner:{owner:partnerOwner,title:partnerTitle,trainerId:partnerTrainerId}};
 const fireRedPartner=partnerTitle==='firered';
 if(!(fireRedPartner?selectPartnerPlaceholder([partner]):selectLocalTradePartner([partner]))||sameEvolutionIndividual(source,partner))throw Error('No eligible native trade partner is verified.');
 if(start?.kind!=='trade'||start.fromGame!=='firered'||!['emerald','firered'].includes(partnerTitle)||(partnerTitle==='emerald')!==(start.partner===undefined)||start.speciesId!==nationalSpeciesId(source.species))throw Error('This source does not match the next FireRed partner transfer.');
 if(fireRedPartner){
  if(!OWNER.test(sourceOwner)||!OWNER.test(partnerOwner)||sourceOwner===partnerOwner)throw Error('The source and partner saves need two distinct owners.');
  const trainer=id=>Number.isInteger(id)&&id>=0&&id<=65535;
  if(!trainer(sourceTrainerId)||!trainer(partnerTrainerId)||sourceTrainerId===partnerTrainerId)throw Error('The source and partner saves need distinct verified trainer IDs.');
 }
 const throughIndex=e.steps.findIndex((s,i)=>i>e.index&&s.kind==='trade'&&s.fromGame===partnerTitle&&s.toGame==='firered'&&(s.partner??'emerald')===partnerOwner);
 if(throughIndex<0)throw Error('The evolution route has no verified return to FireRed.');
 const middle=e.steps.slice(e.index+1,throughIndex),targetSpecies=e.steps[throughIndex].speciesId;
 const rule=getRule(start.speciesId,targetSpecies);
 let method;
 if(start.evolution&&middle.length===0&&rule?.trigger==='trade')method='trade';
 else if(!start.evolution&&middle.length===1&&middle[0].kind==='evolve'&&middle[0].game==='emerald'&&middle[0].fromSpecies===start.speciesId&&middle[0].speciesId===targetSpecies&&rule?.evolutionGame==='emerald'&&[196,197].includes(targetSpecies))method='time';
 else if(!start.evolution&&middle.length===1&&middle[0].kind==='evolve'&&middle[0].game==='emerald'&&rule?.beauty)method='beauty';
 else throw Error('This external evolution route needs a compatible receiving-game executor.');
 if(fireRedPartner&&method!=='trade')throw Error('A FireRed partner serves only trade evolutions.');
 if(source.heldItem===195)throw Error('Remove the source Everstone before the evolution transfer.');
 if(['time','beauty'].includes(method)&&source.level>=100)throw Error('A level 100 source cannot perform this native level-up evolution.');
 if(method==='beauty'&&(!Number.isInteger(source.beauty)||!Number.isInteger(source.sheen)||source.beauty<170&&source.sheen>=255))throw Error('The native Beauty/Sheen values must allow a complete feeding plan before transfer.');
 if(rule?.heldItem&&source.heldItem!==rule.heldItem.nativeId)throw Error('The required trade evolution held item is not equipped.');
 return {schema:'pokemon-suite/local-evolution/v1',roles:structuredClone(roles),requestId:e.requestId,index:e.index,throughIndex,method,targetSpecies,source:structuredClone(source),partner:structuredClone(partner),sourceFingerprint:encounterFingerprint(source),partnerFingerprint:encounterFingerprint(partner),consumedItem:rule?.heldItem?.nativeId??null,steps:structuredClone(e.steps.slice(e.index,throughIndex+1))};
}

export function verifyLocalEvolutionExchange(r,leg,receipts){
 if(!['outbound','return'].includes(leg))throw Error('Unknown evolution exchange.');
 const roles=pairRoles(r),receipt={source:byRole(receipts,roles,'source'),partner:byRole(receipts,roles,'partner')};
 for(const role of ['source','partner']){
  const value=receipt[role];
  if(value?.requestId!==r.requestId||!ownedBy(value,roles,role)||value.leg!==leg)throw Error('The native exchange belongs to another request, leg, owner or role.');
  if(!value.nativeSaveVerified||!value.handshakeVerified||!value.linkClosedVerified||!/^[a-f0-9]{64}$/.test(value.savedSramSha256??''))throw Error('Both native saves and normal exits must be verified.');
 }
 const received=receipt[leg==='outbound'?'partner':'source'].pokemon;
 const temporary=receipt[leg==='outbound'?'source':'partner'].pokemon;
 const expected=leg==='return'||r.method==='trade'?r.targetSpecies:nationalSpeciesId(r.source.species);
 if(!sameEvolutionIndividual(r.source,received)||!sameEvolutionIndividual(r.partner,temporary)||encounterFingerprint(temporary)!==r.partnerFingerprint)throw Error('The reserved trade identity is not verified.');
 if(nationalSpeciesId(received.species)!==expected)throw Error('The expected evolution species is not verified.');
 if(r.consumedItem&&received.heldItem!==0)throw Error('The native evolution held item consumption is not verified.');
 const offeredSource=leg==='outbound'?r.sourceFingerprint:encounterFingerprint(received);
 if(receipt.source.offeredFingerprint!==(leg==='outbound'?offeredSource:r.partnerFingerprint)||receipt.partner.offeredFingerprint!==(leg==='outbound'?r.partnerFingerprint:offeredSource))throw Error('The native offered identity is not verified.');
 return received;
}
