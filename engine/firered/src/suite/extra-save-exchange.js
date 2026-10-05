// Extra saves, part 2: verified FireRed↔FireRed exchanges with another owned
// save. Every exchange is made of single native trade legs through the
// existing local link (local-evolution-worker.js, method 'single'):
//  - register: the partner lends X, the main save receives it (the trade scene
//    registers it as caught), and the next leg trades X back;
//  - loan: as register, with the main save's own Four Island Day Care in
//    between (X and the main save's Ditto) until an Egg is produced; X returns
//    before the Egg hatches;
//  - keep: a helper save hands over an individual it obtained for the main
//    save, and keeps the main save's ordinary duplicate in return.
// The partner is net zero after register and loan (its exact party and PC).
// Shinies, Eggs, item holders and mythicals are never offered by either side.
// Only controller inputs play the games; this module never writes memory.
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
import {NativeAcquisitionTask,acquisitionField,acquiredPokemon} from './acquisition-task.js';
import {TradePreparation} from './trade-preparation.js';
import {BreedingTask} from './native-breeding.js';
import {storageCapacity} from './storage-capacity.js';
import {fireRedPokemonCenter} from './fire-red-link-quest.js';
import {sameEvolutionIndividual,verifyLocalEvolutionExchange,partnerHoldings,verifyPartnerNetZero} from './local-evolution.js';
import {eligibleLoanSubject,selectMainPlaceholder,describeSaveInventory,planExtraSaves,presentExtraSavePlan,LEGENDARY} from './extra-saves.js';
import {helperTaskHunt} from './extra-save-tasks.js';

const OWNER=/^[a-zA-Z0-9_-]{1,100}$/;
const FP=/^\[/;
const MODES=new Set(['register','loan','keep']);
const DAYCARE_FEES=20000;
const clone=v=>v==null?v:structuredClone(v);
const trainerId=id=>Number.isInteger(id)&&id>=0&&id<=65535;

// The postgame preparation of the main save that owns a leg, if any.
export function extraSaveLeg(state){
 const p=state?.preparation;
 return state?.acquisition?.kind==='extra-save'&&p?.kind==='extra-save'&&OWNER.test(p.requestId??'')&&OWNER.test(p.partnerOwner??'')&&p.offer?p:null;
}

function checkOffer(offer){
 if(offer?.schema!=='pokemon-suite/extra-save-offer/v1'||!OWNER.test(offer.exchangeId??'')||!MODES.has(offer.mode)||!['open','close'].includes(offer.leg)||
  !FP.test(offer.fingerprint??'')||!FP.test(offer.expectSource??'')||offer.leg==='close'&&offer.mode==='keep')throw Error('The extra-save offer is invalid.');
 return offer;
}

// One trade leg: each side offers exactly the individual the offer names.
export function reserveExtraSaveTrade({leg,source,partner,sourceOwner='firered',sourceTrainerId,partnerTrainerId,partnerTitle,sourceFlags={},partnerReady={}}){
 const offer=checkOffer(leg?.offer),partnerOwner=leg.partnerOwner;
 if(partnerTitle!=='firered')throw Error('An extra-save exchange needs a FireRed partner owner.');
 if(!OWNER.test(sourceOwner)||!OWNER.test(partnerOwner)||sourceOwner===partnerOwner)throw Error('The source and partner saves need two distinct owners.');
 if(!trainerId(sourceTrainerId)||!trainerId(partnerTrainerId)||sourceTrainerId===partnerTrainerId)throw Error('The source and partner saves need distinct verified trainer IDs.');
 const sourceFingerprint=encounterFingerprint(source),partnerFingerprint=encounterFingerprint(partner);
 if(sourceFingerprint!==offer.expectSource||partnerFingerprint!==offer.fingerprint)throw Error('The prepared Pokémon do not match this exchange leg.');
 for(const p of [source,partner])if(p?.validity!=='valid'||p.shiny!==false||p.isEgg!==false||p.heldItem!==0)throw Error('Only ordinary, non-shiny Pokémon without held items are exchanged.');
 const species=[source,partner].map(p=>nationalSpeciesId(p.species));
 if(species.some(id=>!Number.isInteger(id)))throw Error('The exchanged species could not be verified.');
 if(offer.mode!=='register'&&species.some(id=>LEGENDARY.has(id)))throw Error('A legendary Pokémon is only ever registered and returned.');
 const national=species.some(id=>id>151);
 if(!(sourceFlags[2089]===true||sourceFlags[2092]===true)||partnerReady.pokedex!==true||national&&(sourceFlags[2112]!==true||partnerReady.nationalDex!==true))
  throw Error('Both FireRed saves need the Pokédex, and the National Pokédex for a species outside #1–151, before this trade.');
 return {schema:'pokemon-suite/local-evolution/v1',method:'single',requestId:leg.requestId,index:0,throughIndex:0,
  roles:{source:{owner:sourceOwner,title:'firered',trainerId:sourceTrainerId},partner:{owner:partnerOwner,title:'firered',trainerId:partnerTrainerId}},
  exchange:{exchangeId:offer.exchangeId,mode:offer.mode,leg:offer.leg},targetSpecies:species[0],
  source:clone(source),partner:clone(partner),sourceFingerprint,partnerFingerprint,consumedItem:null,
  steps:[{kind:'trade',fromGame:'firered',toGame:'firered',partner:partnerOwner,speciesId:species[0]}]};
}

// ---- The partner side --------------------------------------------------------
// The partner's ledger survives its restarts (session metadata): the loan it
// has open, and the individuals a helper save may give away for good.
export function emptyPartnerLedger(grants=[]){
 return {schema:'pokemon-suite/extra-save-ledger/v1',open:null,grants:[...new Set(grants.filter(g=>FP.test(g)))],history:[]};
}
// The individual this partner offers for a requested leg, or why not.
export function selectExtraSaveOffer({trainer,offer,ledger}){
 let spec;try{spec=checkOffer(offer);}catch(error){return {reason:error.message};}
 if(trainer?.partyValidity!=='valid'||trainer.storage?.validity!=='valid')return {reason:'The partner party and PC could not be verified.'};
 const all=[...trainer.party,...trainer.storage.pokemon],matches=all.filter(p=>encounterFingerprint(p)===spec.fingerprint);
 const member=trainer.party.filter(p=>encounterFingerprint(p)===spec.fingerprint);
 if(matches.length!==1)return {reason:'The requested Pokémon is missing or duplicated in this save.'};
 if(member.length!==1)return {reason:'The requested Pokémon must be in the party. Save it in the party at this Pokémon Center first.'};
 const p=member[0],open=ledger?.open;
 if(spec.leg==='close'){
  if(open?.exchangeId!==spec.exchangeId||open.received!==spec.fingerprint||open.lent!==spec.expectSource)return {reason:'This save has no open loan for that return.'};
  return {pokemon:p};
 }
 if(open)return {reason:`This save is lending to exchange ${open.exchangeId}; it serves nothing else until that Pokémon returns.`};
 if(!eligibleLoanSubject(p,{mode:spec.mode}))return {reason:'Only an ordinary, non-shiny Pokémon without a held item can be lent; a legendary is only registered.'};
 if(spec.mode==='keep'&&!(ledger?.grants??[]).includes(spec.fingerprint))return {reason:'This save keeps its own Pokémon. Only an individual it obtained for the main save can be given away.'};
 return {pokemon:p};
}
// After a leg, this save must hold exactly what the leg implies; after a
// return it must hold exactly its original Pokémon again.
export function verifyPartnerExchangeLeg({preparation,reservation:r,trainer,ledger}){
 const offer=checkOffer(preparation?.offer);
 if(r?.method!=='single'||r.exchange?.exchangeId!==offer.exchangeId||r.exchange.leg!==offer.leg||r.partnerFingerprint!==offer.fingerprint||r.sourceFingerprint!==offer.expectSource)throw Error('The completed leg does not match this partner\'s offer.');
 const before=preparation.holdings,after=partnerHoldings(trainer);
 if(!Array.isArray(before?.party)||!Array.isArray(before?.storage))throw Error('The partner holdings before this leg were not recorded.');
 const expected={party:[...before.party.filter(fp=>fp!==r.partnerFingerprint),r.sourceFingerprint].sort(),storage:before.storage};
 if(before.party.filter(fp=>fp===r.partnerFingerprint).length!==1||JSON.stringify(after)!==JSON.stringify(expected))throw Error('The partner does not hold exactly what this exchange leg implies. Its save is preserved for review.');
 let netZeroVerified=false;
 if(offer.leg==='close'){
  if(ledger?.open?.exchangeId!==offer.exchangeId)throw Error('The partner has no record of this loan.');
  verifyPartnerNetZero(ledger.open.holdingsBefore,trainer);netZeroVerified=true;
 }
 if(offer.mode==='keep'&&!(ledger?.grants??[]).includes(r.partnerFingerprint))throw Error('The partner gave away an individual it was not granted to give.');
 return {schema:'pokemon-suite/extra-save-leg-proof/v1',exchangeId:offer.exchangeId,mode:offer.mode,leg:offer.leg,sourceOwner:r.roles.source.owner,
  lent:r.partnerFingerprint,received:r.sourceFingerprint,holdingsBefore:clone(before),netZeroVerified,
  summary:offer.leg==='close'?'The lent Pokémon returned; the partner holds exactly its original Pokémon again.':
   offer.mode==='keep'?'The partner handed over its obtained Pokémon and keeps the main save\'s duplicate.':
   'The partner lent its Pokémon and holds the main save\'s duplicate until it returns.'};
}
export function applyPartnerLegProof(ledger,proof){
 const next=clone(ledger??emptyPartnerLedger());
 if(proof.leg==='open'&&proof.mode!=='keep')next.open={exchangeId:proof.exchangeId,mode:proof.mode,lent:proof.lent,received:proof.received,holdingsBefore:clone(proof.holdingsBefore),sourceOwner:proof.sourceOwner};
 if(proof.leg==='close')next.open=null;
 if(proof.mode==='keep')next.grants=next.grants.filter(g=>g!==proof.lent);
 next.history=[...next.history,{exchangeId:proof.exchangeId,mode:proof.mode,leg:proof.leg,lent:proof.lent,received:proof.received,netZeroVerified:proof.netZeroVerified}].slice(-20);
 return next;
}

// ---- The main side -----------------------------------------------------------
const nurseIndexOf=(world,center)=>(world.data??world).maps.find(m=>m.id===center)?.objectEvents?.findIndex(e=>/EventScript_Nurse$/.test(e.script))??-1;
const HATCH_MAP='MAP_FOUR_ISLAND_POKEMON_CENTER_1F';

export class ExtraSaveExchangeTask extends NativeAcquisitionTask{
 constructor({requestId,route,world,mechanics,planner,state=null,protectedFingerprints=[]}){
  super();this.world=world;this.mechanics=mechanics;this.planner=planner;
  if(state){
   if(state.kind!=='extra-save'||state.requestId!==requestId)throw Error('The extra-save checkpoint belongs to another exchange.');
   this.state=clone(state);return;
  }
  if(!OWNER.test(requestId??'')||!MODES.has(route?.mode)||!OWNER.test(route.partnerOwner??'')||!FP.test(route.subject?.fingerprint??'')||route.mode==='loan'&&(!Number.isInteger(route.breed?.speciesId)||!FP.test(route.breed?.dittoFingerprint??'')))
   throw Error('An extra-save exchange needs a verified route, partner owner and subject.');
  this.state={schema:'pokemon-suite/native-acquisition/v1',kind:'extra-save',requestId,route:clone(route),phase:'preparing',protectedFingerprints:[...protectedFingerprints],
   placeholder:null,transfer:null,pendingLeg:null,legs:[],daycare:null,egg:null,daycareSkipped:null,dirty:false,receipt:null};
 }
 legId(leg){return `${this.state.requestId}-${leg}`.slice(0,100);}
 progressEvidence(o){return this.state.phase==='daycare'&&this.state.daycare?this.breeding().progressEvidence(o):null;}
 progressTimeoutCause(o){return this.state.phase==='daycare'&&this.state.daycare?this.breeding().progressTimeoutCause(o):null;}
 breeding(parents){
  const s=this.state;
  this.daycareTask??=new BreedingTask({requestId:this.legId('daycare'),speciesId:s.route.breed.speciesId,parents,world:this.world,mechanics:this.mechanics,planner:this.planner,state:s.daycare});
  return this.daycareTask;
 }
 transfer(o,leg,fingerprint){
  const s=this.state;
  const center=s.transfer?.center??fireRedPokemonCenter(o.playerMemory.map.id),nurseIndex=nurseIndexOf(this.world,center);
  if(!(nurseIndex>=0))return this.stop('The Pokémon Center nurse for the exchange could not be verified.');
  const prep=new TradePreparation({receipt:{requestId:this.legId(leg),fingerprint,state:'owned-awaiting-save'},center,nurseIndex,mechanics:this.mechanics,world:this.world,state:s.transfer});
  const next=prep.inspect(o);s.transfer=prep.state;
  if(next.kind!=='ready')return next.kind==='policy'?{...next,objective:{...next.objective,identityEvolution:true}}:next.kind==='stop'?this.stop(next.reason):next;
  const route=s.route,open=leg==='open';
  s.pendingLeg={requestId:this.legId(leg),leg,expectSource:fingerprint,expectPartner:open?route.subject.fingerprint:s.placeholder.fingerprint};
  return {kind:'transfer',requestId:s.pendingLeg.requestId,partnerOwner:route.partnerOwner,tradePreparation:clone(prep.state),
   offer:{schema:'pokemon-suite/extra-save-offer/v1',exchangeId:s.requestId,mode:route.mode,leg,fingerprint:s.pendingLeg.expectPartner,expectSource:fingerprint},
   reason:open?`Waiting for ${route.sourceLabel??route.partnerOwner} to ${route.mode==='keep'?'hand over':'lend'} its Pokémon.`:`Returning the borrowed Pokémon to ${route.sourceLabel??route.partnerOwner}.`};
 }
 // Called by the source worker after both native saves verified one leg.
 acceptTrade(result,o){
  const s=this.state,leg=s.pendingLeg,r=result?.reservation;
  if(!leg||r?.method!=='single'||r.requestId!==leg.requestId||r.exchange?.exchangeId!==s.requestId||r.exchange.leg!==leg.leg||r.sourceFingerprint!==leg.expectSource||r.partnerFingerprint!==leg.expectPartner)
   throw Error('The completed trade does not match the pending extra-save leg.');
  verifyLocalEvolutionExchange(r,'outbound',result.outbound);
  const receipt=result.outbound.source??result.outbound.firered,got=receipt?.pokemon,t=o?.playerMemory?.trainer;
  if(!got||encounterFingerprint(got)!==leg.expectPartner||!sameEvolutionIndividual(r.partner,got))throw Error('The received Pokémon is not the reserved individual.');
  const held=(t?.party??[]).filter(p=>encounterFingerprint(p)===leg.expectPartner),all=[...(t?.party??[]),...(t?.storage?.pokemon??[])];
  if(!acquisitionField(o)||t?.partyValidity!=='valid'||held.length!==1||all.some(p=>encounterFingerprint(p)===leg.expectSource)||o.sram?.sha256!==receipt.savedSramSha256)
   throw Error('The received Pokémon is not verified in the current native save.');
  const species=nationalSpeciesId(got.species);
  if(leg.leg==='open'&&!t.pokedex?.ownedSpecies?.includes(species))throw Error('The received Pokémon is not registered in the Pokédex.');
  s.legs.push({leg:leg.leg,requestId:leg.requestId,received:leg.expectPartner,offered:leg.expectSource,species,savedSramSha256:receipt.savedSramSha256,savedFrame:o.frame,pairId:receipt.pairId??null});
  s.pendingLeg=null;s.transfer=null;s.reason=null;
  if(leg.leg==='open'){
   if(s.route.mode==='keep'){s.dirty=false;s.result=clone(held[0]);s.phase='restoring';return;}
   s.dirty=true;s.borrowed=clone(held[0]);s.phase=s.route.mode==='loan'?'daycare':'closing';return;
  }
  // The borrowed Pokémon is back with its owner; an Egg still hatches here.
  s.dirty=Boolean(s.egg);s.result=clone(held[0]);s.phase=s.egg?'hatching':'restoring';
 }
 finish(o,pokemon,extra={}){
  const s=this.state;
  s.receipt={requestId:s.requestId,method:'extra-save',mode:s.route.mode,needId:s.route.needId??null,partnerOwner:s.route.partnerOwner,pokemon:clone(pokemon),fingerprint:encounterFingerprint(pokemon),
   registered:[...new Set(s.legs.filter(l=>l.leg==='open').map(l=>l.species).concat(extra.hatched?[extra.hatched]:[]))],legs:clone(s.legs),daycareSkipped:s.daycareSkipped,
   nativeSaveVerified:true,savedFrame:o.frame,savedSramSha256:o.sram.sha256,...extra};
  s.phase='complete';s.dirty=false;return {kind:'complete',receipt:s.receipt};
 }
 inspectDaycare(o){
  const s=this.state,task=this.breeding(),next=task.inspect(o);s.daycare=clone(task.state);
  if(task.state.phase==='hatching'||task.state.receipt){s.egg=task.state.egg;s.phase='closing';return {kind:'wait'};}
  // Before anything is deposited a refusal only skips the Egg; the borrowed
  // Pokémon still goes back. Afterwards the Day Care's own stop stands.
  if(next.kind==='stop'&&!task.state.deposited&&!task.state.egg){s.daycareSkipped=next.reason;s.phase='closing';s.daycare=null;this.daycareTask=null;return {kind:'wait'};}
  return next;
 }
 inspect(o){
  const s=this.state,m=o.playerMemory??{},t=m.trainer??{};
  if(s.receipt)return {kind:'complete',receipt:s.receipt};
  // The Day Care task owns its own menus, including frames that are not a
  // stable field (its withdrawal list); it waits or stops on its own.
  if(s.phase==='daycare'&&(s.daycare||this.daycareTask))return this.inspectDaycare(o);
  // A team restore in progress keeps driving its own PC session until the field is free.
  if(s.phase==='restoring'&&s.restoreGoal){if(!acquisitionField(o))return {kind:'policy',objective:s.restoreGoal};s.restoreGoal=null;}
  if(o.emulator?.inBattle)return {kind:'wait'};
  if(o.phase!=='stable'||t.partyValidity!=='valid'||t.storage?.validity!=='valid')return acquisitionField(o)?this.stop('Verify the party and PC before the exchange.'):{kind:'wait'};
  if(s.pendingLeg&&s.transfer?.phase==='ready')return this.transfer(o,s.pendingLeg.leg,s.pendingLeg.expectSource);
  const all=acquiredPokemon(o),count=fp=>all.filter(p=>encounterFingerprint(p)===fp).length;
  if(s.phase==='preparing'){
   // Everything that could stop the exchange is checked before any Pokémon leaves.
   const placeholder=selectMainPlaceholder({trainer:t,protectedFingerprints:[...s.protectedFingerprints,...(s.route.breed?[s.route.breed.dittoFingerprint]:[])]});
   if(!placeholder)return this.stop('The main save has no ordinary PC duplicate to offer in exchange.');
   if(s.route.mode!=='keep'&&!storageCapacity(t).canStart)return this.stop('Keep the PC reserve free before borrowing a Pokémon.');
   if(s.route.mode==='loan'){
    const dc=m.postgameEvidence?.acquisition?.daycare;
    if(count(s.route.breed.dittoFingerprint)!==1)return this.stop('The main save\'s Ditto for this Egg is missing or duplicated.');
    if(dc?.validity!=='valid'||dc.parents.length||dc.pendingEgg!==false)return this.stop('The Four Island Day Care must be empty before borrowing a parent.');
    if(!Number.isSafeInteger(t.money)||t.money<DAYCARE_FEES)return this.stop('Reserve ₽20,000 for the Day Care before borrowing a parent.');
   }
   s.placeholder={fingerprint:encounterFingerprint(placeholder),species:nationalSpeciesId(placeholder.species),pokemon:clone(placeholder)};s.phase='opening';
   s.originalParty=t.party.map(encounterFingerprint);
  }
  if(s.phase==='opening'){
   if(count(s.placeholder.fingerprint)!==1)return this.stop('The offered duplicate is missing or duplicated.');
   return this.transfer(o,'open',s.placeholder.fingerprint);
  }
  if(s.phase==='daycare'){
   const borrowed=all.find(p=>encounterFingerprint(p)===s.route.subject.fingerprint)??s.borrowed,ditto=all.find(p=>encounterFingerprint(p)===s.route.breed.dittoFingerprint);
   try{this.breeding([borrowed,ditto]);}catch(error){s.daycareSkipped=error.message;s.phase='closing';return this.inspect(o);}
   return this.inspectDaycare(o);
  }
  if(s.phase==='closing'){

   if(count(s.route.subject.fingerprint)!==1)return this.stop('The borrowed Pokémon is missing or duplicated. Its return is preserved for review.');
   return this.transfer(o,'close',s.route.subject.fingerprint);
  }
  if(s.phase==='hatching'){
   const egg=all.find(p=>encounterFingerprint(p)===s.egg);
   if(!egg)return this.stop('The Day Care Egg is missing.');
   if(egg.isEgg)return this.policy('hatch',{kind:'friendship-walk',map:HATCH_MAP,fingerprint:s.egg});
   const hatched=nationalSpeciesId(egg.species);
   if(!t.pokedex?.ownedSpecies?.includes(hatched))return this.stop('The hatched Pokémon is absent from the native Pokédex.');
   s.hatched={fingerprint:s.egg,species:hatched};s.result=clone(egg);s.phase='restoring';
  }
  if(s.phase==='restoring'){
   // The team the exchange found returns to the party before the final save.
   const original=(s.originalParty??[]).filter(fp=>count(fp)===1),party=t.party.map(encounterFingerprint);
   if(!s.save&&original.length===(s.originalParty??[]).length&&(party.length!==original.length||original.some(fp=>!party.includes(fp)))){
    if(!acquisitionField(o))return this.drain(o);
    const next=this.policy('restore-team',{kind:'party-roster',map:fireRedPokemonCenter(m.map.id),minimumPartySize:original.length,maximumPartySize:original.length,requiredFingerprints:original,
     requiredFamilies:t.party.filter(p=>p.moves?.includes(19)&&!original.includes(encounterFingerprint(p))).map(p=>[p.species])});
    s.restoreGoal=next.objective;return next;
   }
   const result=all.find(p=>encounterFingerprint(p)===encounterFingerprint(s.result))??s.result;
   const saved=this.save(o,result,{});
   if(saved.kind!=='complete')return saved;
   return this.finish(o,result,s.hatched?{hatched:s.hatched.species}:{});
  }
  return this.stop('The extra-save exchange is in an unknown phase.');
 }
}

// ---- Choosing an exchange for the main save --------------------------------
// The plan and its presentation are refreshed when the published sources or
// the main save's Pokédex and holdings change.
export function refreshExtraSavePlan({o,sources,workflow,world}){
 const t=o?.playerMemory?.trainer;
 if(!sources?.sources?.length||o?.phase!=='stable'||t?.partyValidity!=='valid'||t.storage?.validity!=='valid')return workflow?.plan??null;
 const key=JSON.stringify([sources.checkedAt??null,sources.sources.length,t.pokedex?.ownedSpecies?.length??null,[...t.party,...t.storage.pokemon].map(encounterFingerprint).sort(),
  workflow.active??null,(sources.helpers??[]).map(h=>[h.saveId,h.objective,h.status])]);
 if(workflow.planKey===key&&workflow.plan)return workflow.plan;
 const inventory=describeSaveInventory({observation:o,world,source:{kind:'main',owner:'firered',label:'Main save'},roamer:o.playerMemory?.postgameEvidence?.roamer??null});
 if(!inventory.valid)return workflow.plan??null;
 const main=workflow.active?.borrowed?{...inventory,pokemon:inventory.pokemon.filter(p=>p.fingerprint!==workflow.active.borrowed)}:inventory;
 workflow.plan=planExtraSaves({main,sources:sources.sources});workflow.planKey=key;
 // A helper task row carries the exact hunt the host starts for it (build 126).
 workflow.presentation=presentExtraSavePlan(workflow.plan,{active:workflow.active??null,helpers:sources.helpers??[]}).map(row=>row.task?{...row,task:{...row.task,hunt:helperTaskHunt(row.task)}}:row);
 return workflow.plan;
}
// The postgame asks here only when no local checklist work is selectable. The
// route's partner owner must be listed as available by the host.
export function selectExtraSaveObjective({o,sources,available,protectedFingerprints=[],workflow={},world,now=Date.now()}){
 const plan=refreshExtraSavePlan({o,sources,workflow,world});
 if(!plan)return null;
 const partners=new Set((available?.available===true&&Array.isArray(available.partners)?available.partners:[]).filter(p=>p?.title==='firered').map(p=>p.owner));
 const route=plan.routes.find(r=>r.status==='ready'&&r.source?.owner&&partners.has(r.source.owner)&&!(workflow.deferred?.[r.needId]?.retryAt>now));
 if(!route)return null;
 return {id:`extra-save-${route.needId}`,label:`Extra save: ${route.label}`,target:{kind:'postgame-acquire'},
  acquisition:{kind:'extra-save',protectedFingerprints,route:{needId:route.needId,mode:route.mode,partnerOwner:route.source.owner,sourceLabel:route.source.label,subject:route.subject,...(route.breed?{breed:route.breed}:{})}}};
}
// A clean exchange (nothing borrowed) that cannot continue waits five minutes
// and lets other work run; a borrowed Pokémon never leaves its exchange.
export function deferExtraSaveNeed(workflow,task,reason,now){
 if(task?.kind!=='extra-save'||task.dirty)return false;
 (workflow.deferred??={})[task.route.needId]={retryAt:now+300000,reason};workflow.active=null;
 return true;
}
