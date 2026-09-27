import {NativeAcquisitionTask,acquisitionField,acquiredPokemon} from './acquisition-task.js';
import {encounterFingerprint as fingerprint} from '../player/encounter-tracker.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
import {fireRedEvolutionRules} from './fire-red-evolution.js';
import {storageCapacity} from './storage-capacity.js';
const rules=fireRedEvolutionRules(),HOUSE='MAP_FOUR_ISLAND_POKEMON_DAY_CARE',CENTER='MAP_FOUR_ISLAND_POKEMON_CENTER_1F';
// Original FireRed include/constants/items.h and daycare.c.
const SEA_INCENSE=220,LAX_INCENSE=221;
// The Egg wait's native rolls count as watchdog progress up to this bound: 64
// failed rolls at the lowest nonzero compatibility (20%) is 0.8^64 ≈ 6e-7.
const EGG_ROLL_CREDIT=64;
const count=(t,id)=>Object.values(t.bag??{}).flat().reduce((n,i)=>n+(i?.itemId===id?i.quantity:0),0);
const gender=(p,f)=>{
 const ratio=f?.genderRatio;
 if(ratio==='MON_GENDERLESS')return null;
 if(ratio==='MON_FEMALE')return 'female';if(ratio==='MON_MALE')return 'male';
 return ratio?.call==='PERCENT_FEMALE'?(p.personality&255)<Math.floor(255*ratio.args[0]/100)?'female':'male':null;
};
function eggOptions(a,b,mechanics){
 const species=(mechanics.data??mechanics).species,fa=species.find(f=>f.id===a.species),fb=species.find(f=>f.id===b.species);
 if(!fa?.eggGroups||!fb?.eggGroups||[fa,fb].some(f=>f.eggGroups.includes('EGG_GROUP_UNDISCOVERED')))return [];
 const ditto=p=>p.species===132;
 if(ditto(a)&&ditto(b))return [];
 if(!ditto(a)&&!ditto(b)&&(!gender(a,fa)||!gender(b,fb)||gender(a,fa)===gender(b,fb)||!fa.eggGroups.some(g=>fb.eggGroups.includes(g))))return [];
 const mother=ditto(a)?b:ditto(b)?a:gender(a,fa)==='female'?a:b;
 let base=nationalSpeciesId(mother.species);
 for(let i=0;i<5;i++){const r=rules.find(r=>r.speciesId===base);if(!r)break;base=r.fromSpecies;}
 if(base===29)return [{speciesId:29},{speciesId:32}];
 if(base===314)return [{speciesId:314},{speciesId:313}];
 if(base===298)return [{speciesId:183},{speciesId:298,itemId:SEA_INCENSE}];
 if(base===360)return [{speciesId:202},{speciesId:360,itemId:LAX_INCENSE}];
 return [{speciesId:base}];
}
export function selectOwnedBreeding({trainer,mechanics,protectedFingerprints=[],allowOwned=false}){
 if(trainer?.partyValidity!=='valid'||trainer.storage?.validity!=='valid'||!storageCapacity(trainer).canStart)return null;
 const protectedIds=new Set([...protectedFingerprints,...trainer.party.map(fingerprint)]),owned=new Set((trainer.pokedex?.ownedSpecies??[]).map(nationalSpeciesId));
 const parents=trainer.storage.pokemon.filter(p=>p.validity==='valid'&&!p.isEgg&&p.shiny===false&&!protectedIds.has(fingerprint(p)));
 for(let i=0;i<parents.length;i++)for(let j=i+1;j<parents.length;j++){
  const pair=[parents[i],parents[j]];
  for(const option of eggOptions(...pair,mechanics)){
   if(!allowOwned&&owned.has(option.speciesId))continue;
   if(option.itemId&&!pair.some(p=>p.heldItem===option.itemId)&&(!count(trainer,option.itemId)||!pair.some(p=>p.heldItem===0)))continue;
   // Holding incense produces the baby, so a normal base request must not
   // silently claim the other species is deterministic.
   if(option.speciesId===183&&pair.some(p=>p.heldItem===SEA_INCENSE)||option.speciesId===202&&pair.some(p=>p.heldItem===LAX_INCENSE))continue;
   return {...option,parents:structuredClone(pair)};
  }
 }
 return null;
}

export class BreedingTask extends NativeAcquisitionTask{
 constructor({requestId,speciesId,parents,itemId=null,world,mechanics,planner,state=null}){
  super();this.world=world;this.mechanics=mechanics;this.planner=planner;
  if(state){
   if(state.kind!=='breeding'||state.requestId!==requestId||state.speciesId!==speciesId)throw Error('The daycare checkpoint belongs to another acquisition.');
   this.state=structuredClone(state);return;
  }
  if(!requestId||parents?.length!==2||parents.some(p=>p.validity!=='valid'||p.shiny!==false||p.isEgg)||fingerprint(parents[0])===fingerprint(parents[1])||!eggOptions(...parents,mechanics).some(p=>p.speciesId===speciesId&&p.itemId===(itemId??undefined)))throw Error('Breeding requires two identified compatible spare parents and the native offspring requirements.');
  this.state={schema:'pokemon-suite/native-acquisition/v1',kind:'breeding',requestId,speciesId,parents:structuredClone(parents),itemId,phase:'preparing',feesPaid:0,parentsReturned:[]};
 }
 // Pending-Egg rolls the cartridge has made for the deposited pair: one each time
 // the second parent's step counter reaches xFF with no Egg held (daycare.c
 // TryProduceOrHatchEgg). A low-compatibility pair can need many of them.
 eggRolls(o){
  const dc=o.playerMemory?.postgameEvidence?.acquisition?.daycare,second=dc?.parents?.find(p=>p.slot===1);
  if(this.state.phase!=='waiting-for-egg'||dc?.validity!=='valid'||dc.parents.length!==2||dc.pendingEgg!==false||dc.offspringPersonality!==0||!Number.isSafeInteger(second?.steps))return null;
  return Math.floor((second.steps+1)/256);
 }
 // Watchdog evidence of this owner's own native wait. It stops changing after the
 // credited rolls, so an Egg that never comes still reaches the progress timeout.
 progressEvidence(o){const rolls=this.eggRolls(o);return rolls==null?null:['daycare-egg-rolls',Math.min(rolls,EGG_ROLL_CREDIT)];}
 progressTimeoutCause(o){const rolls=this.eggRolls(o);return rolls>EGG_ROLL_CREDIT?`The Day Care produced no Egg in ${rolls} rolls.`:null;}
 inspect(o){
  const s=this.state,m=o.playerMemory??{},t=m.trainer??{},a=m.postgameEvidence?.acquisition,dc=a?.daycare;
  if(o.emulator?.inBattle)return {kind:'wait'};
  if(!dc||dc.validity!=='valid'||t.partyValidity!=='valid'||t.storage?.validity!=='valid')return acquisitionField(o)?this.stop('The native daycare, party and PC must all verify before breeding.'):{kind:'wait'};
  if(s.receipt)return {kind:'complete',receipt:s.receipt};
  const ids=s.parents.map(fingerprint),all=acquiredPokemon(o),inside=dc.parents;
  if(inside.some(p=>!ids.includes(fingerprint(p))))return this.stop('The daycare contains an unreserved Pokémon. Keep the existing parents untouched.');
  if(inside.length){s.dirty=true;s.deposited=true;}
  if(!s.initial){
   if(inside.length||dc.pendingEgg!==false)return this.stop('Begin breeding only with a verified empty daycare and no unclaimed Egg.');
   s.initial=all.map(fingerprint);
   if(!t.party.some(p=>ids.includes(fingerprint(p))))s.originalParty=t.party.map(fingerprint);
  }
  const eggs=all.filter(p=>p.validity==='valid'&&!s.initial.includes(fingerprint(p))&&(p.isEgg||s.egg===fingerprint(p)));
  if(eggs.length>1)return this.stop('The received Egg identity is ambiguous.');
  if(eggs[0]&&!s.egg){s.egg=fingerprint(eggs[0]);s.phase='returning-parents';s.dirty=true;}
  const egg=all.find(p=>fingerprint(p)===s.egg),free=acquisitionField(o);
  for(const id of ids){
   const matches=[...all,...inside].filter(p=>fingerprint(p)===id);
   if(matches.length!==1)return o.phase==='stable'&&free?this.stop('A reserved daycare parent is missing or duplicated.'):{kind:'wait'};
  }
  if(s.withdrawal){
   const w=s.withdrawal,returned=all.find(p=>fingerprint(p)===w.fingerprint);
   if(returned&&!inside.some(p=>fingerprint(p)===w.fingerprint)){
    if(t.money!==w.money-w.cost){if(!free)return this.drain(o);return this.stop('The daycare withdrawal fee does not match the native quoted cost.');}
    s.feesPaid+=w.cost;s.parentsReturned.push(w.fingerprint);s.withdrawal=null;
   }
  }
  if(s.preparationGoal){
   if(!free)return {kind:'policy',objective:s.preparationGoal};
   s.preparationGoal=null;
  }
  const prepare=(suffix,target)=>{const next=this.policy(suffix,target);s.preparationGoal=next.objective;return next;};
  if(egg&&inside.length===0){
   if(s.parentsReturned.length!==2)return this.stop('Both parent withdrawals must be verified before hatching.');
   if(!free&&!s.saving)return this.drain(o);
   if(egg.isEgg){s.phase='hatching';return this.policy('hatch',{kind:'friendship-walk',map:CENTER,fingerprint:s.egg});}
   if(!t.pokedex?.ownedSpecies?.includes(egg.species))return this.stop('The hatched Pokémon is absent from the native Pokédex.');
   for(const original of s.parents){
    const parent=all.find(p=>fingerprint(p)===fingerprint(original));
    if(parent.heldItem!==original.heldItem){
     if(original.heldItem!==0||parent.heldItem!==s.itemId)return this.stop('A returned parent has an unexpected held item.');
     return prepare('return-incense',{kind:'take-held-item',map:m.map.id,fingerprint:fingerprint(parent),itemId:s.itemId});
    }
   }
   if(s.originalParty&&(t.party.length!==s.originalParty.length||!s.originalParty.every(id=>t.party.some(p=>fingerprint(p)===id))))return prepare('restore-team',{kind:'party-roster',map:CENTER,minimumPartySize:s.originalParty.length,maximumPartySize:s.originalParty.length,requiredFingerprints:s.originalParty});
   s.phase='saving';s.saving=true;
   return this.save(o,egg,{parentsReturned:s.parentsReturned,feesPaid:s.feesPaid,requestedSpecies:s.speciesId,matched:nationalSpeciesId(egg.species)===s.speciesId});
  }
  const retrieve=Boolean(egg);
  if(!inside.length&&!retrieve){
   if(t.money<20000){const income=this.planner?.selectIncomePreparation(o);return income?{kind:'policy',objective:income}:this.stop('Reserve ₽20,000 to recover both daycare parents before depositing them.');}
   if(!storageCapacity(t).canStart)return this.stop('Keep free storage before breeding.');
   if(t.party.length>5||!ids.every(id=>t.party.some(p=>fingerprint(p)===id)))return prepare('parents',{kind:'party-roster',map:CENTER,minimumPartySize:3,maximumPartySize:5,requiredFingerprints:ids,requiredFamilies:t.party.filter(p=>p.moves?.includes(19)&&!ids.includes(fingerprint(p))).map(p=>[p.species])});
   if(!t.party.some(p=>!ids.includes(fingerprint(p))&&!p.isEgg&&p.hp>0))return this.stop('Keep a healthy travelling Pokémon outside daycare.');
   if(s.itemId&&!s.parents.some(p=>all.find(q=>fingerprint(q)===fingerprint(p))?.heldItem===s.itemId)){
    const parent=t.party.find(p=>ids.includes(fingerprint(p))&&p.heldItem===0);
    if(!parent||!count(t,s.itemId))return this.stop('The native incense required for this Egg is unavailable.');
    return prepare('incense',{kind:'give-held-item',map:m.map.id,fingerprint:fingerprint(parent),itemId:s.itemId});
   }
  }
  const choose=targetOption=>({kind:'recommendation',recommendation:{kind:'choose-menu-option',targetOption}});
  if(m.ui?.choiceMenu){
   if(['DayCare_Text_DoYouWantEgg','DayCare_Text_IWillKeepDoYouWantIt'].includes(a.prompt))return choose('yes');
   if(a.prompt==='DayCare_Text_WeCanRaiseOneMore')return choose(retrieve?'no':'yes');
   if(a.prompt==='DayCare_Text_WouldYouLikeUsToRaiseMon')return choose(retrieve?'no':'yes');
   if(['DayCare_Text_TakeYourMonBack','DayCare_Text_TakeOtherOneBackToo'].includes(a.prompt))return choose(retrieve?'yes':'no');
   if(a.prompt==='DayCare_Text_ItWillCostX'&&retrieve){
    const parent=inside.find(p=>p.slot===a.selectedParent)??inside[a.selectedParent],cost=a.withdrawalCost;
    if(!parent||!Number.isInteger(cost)||cost<100||cost>10000||cost%100||t.money<cost)return this.stop('The reserved parent or its native daycare withdrawal cost is unverified.');
    s.withdrawal??={fingerprint:fingerprint(parent),money:t.money,cost};return choose('yes');
   }
   return this.stop('The daycare choice is not a verified breeding prompt.');
  }
  if(retrieve&&Number.isInteger(dc.menuCursor))return this.action(dc.menuCursor===0?['a']:['up']);
  if(m.ui?.party){
   if(m.ui.party.menuType!==6||retrieve)return {kind:'recommendation',recommendation:{kind:'close-menu'}};
   const parent=t.party.find(p=>ids.includes(fingerprint(p))&&!inside.some(q=>fingerprint(q)===fingerprint(p)));
   if(parent&&m.ui.party.stage==='selection-menu'){
    if(m.ui.party.selectedPartySlot!==parent.slot)return {kind:'recommendation',recommendation:{kind:'close-menu'}};
    const index=m.ui.party.actions?.indexOf('store')??-1;
    return index>=0?{kind:'recommendation',recommendation:{kind:'choose-party-action',targetAction:'store',targetIndex:index}}:this.stop('The daycare Store action is unavailable.');
   }
   return parent?{kind:'recommendation',recommendation:{kind:'choose-party-member',targetPartySlot:parent.slot,targetSpecies:parent.species}}:this.stop('No reserved parent is available for the daycare party menu.');
  }
  if(o.phase!=='stable')return {kind:'wait'};
  if(!free)return this.drain(o);
  if(retrieve){s.phase='returning-parents';return this.event(HOUSE,'FourIsland_PokemonDayCare_EventScript_DaycareWoman');}
  if(dc.pendingEgg===true){s.phase='receiving-egg';return this.event('MAP_FOUR_ISLAND','FourIsland_EventScript_DaycareMan');}
  if(dc.pendingEgg!==false)return this.stop('The pending daycare Egg flag is unreadable.');
  if(inside.length===2){s.phase='waiting-for-egg';return this.policy('egg-steps',{kind:'friendship-walk',map:CENTER,fingerprint:fingerprint(t.party[0])});}

  s.phase='depositing';return this.event(HOUSE,'FourIsland_PokemonDayCare_EventScript_DaycareWoman');
 }
}
