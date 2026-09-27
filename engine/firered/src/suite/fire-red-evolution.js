import rulesDocument from './fire-red-evolution-rules.json' with {type:'json'};
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
import {fireRedPokemonCenter} from './fire-red-link-quest.js';
import {verifyLocalEvolutionExchange,sameEvolutionIndividual} from './local-evolution.js';

const IVS=['hp','attack','defense','speed','spAttack','spDefense'];
const lineage=p=>p?.validity==='valid'&&Number.isInteger(p.personality)&&Number.isInteger(p.otId)&&IVS.every(k=>Number.isInteger(p.ivs?.[k]))?JSON.stringify([p.personality,p.otId,...IVS.map(k=>p.ivs[k])]):null;
const count=(o,id)=>Object.values(o.playerMemory?.trainer?.bag??{}).flat().reduce((n,i)=>n+(i?.itemId===id?i.quantity:0),0);
const field=o=>o.phase==='stable'&&o.emulator?.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory?.ui??{}).some(Boolean);
const ITEM_BERRY_POUCH=365;
const ruleFor=(from,to)=>rulesDocument.rules.find(r=>r.fromSpecies===from&&r.speciesId===to);
export const fireRedEvolutionRules=()=>structuredClone(rulesDocument.rules);
// A Rare Candy sets experience to the next level's threshold, so progress made
// inside the current level is lost (pret/pokefirered src/pokemon.c). A limited
// stock goes to expensive levels right after a natural level-up; a renewable
// supply candies every level. Unreadable progress keeps the earlier behaviour.
const CANDY_MIN_LEVEL_EXPERIENCE=3000,CANDY_FRESH_LEVEL=0.15;
function candyLevel(p){
 const x=p.experienceProgress,start=Number(x?.levelStart),span=Number(x?.nextLevel)-start,current=Number(x?.current);
 if(!(span>0)||!Number.isFinite(current))return null;
 return {expensive:span>=CANDY_MIN_LEVEL_EXPERIENCE,fresh:(current-start)/span<=CANDY_FRESH_LEVEL};
}
function candyWorthwhile(p,rule,{renewableCandies=false}={}){
 if(renewableCandies||rule.relativeStats!==undefined||p.level>=(rule.level??0))return true;
 const level=candyLevel(p);
 return !level||level.expensive&&level.fresh;
}
export function selectOwnedDexEvolution(options){return ownedDexEvolutionOptions(options)[0]??null;}
// Every owned Dex evolution source, best rank first (one source per rule).
export function ownedDexEvolutionOptions({trainer,protectedFingerprints=[],canSupply=()=>false,scope='preparation'}){
 if(trainer?.partyValidity!=='valid'||trainer.storage?.validity!=='valid')return [];
 const owned=new Set((trainer.pokedex?.ownedSpecies??[]).map(nationalSpeciesId).filter(Boolean)),all=[...trainer.party,...trainer.storage.pokemon],options=[];
 for(const rule of rulesDocument.rules){
  const earlyLevel=rule.nativeMethod==='EVO_LEVEL'&&rule.level<=10;
  if(owned.has(rule.speciesId)||scope!=='national'&&(rule.speciesId>151||rule.nationalDexRequired||scope!=='kanto'&&rule.trigger!=='use-item'&&!earlyLevel))continue;
  if(rule.trigger==='trade'||rule.evolutionGame||rule.beauty)continue;
  const pokemon=all.find(p=>p.validity==='valid'&&p.shiny===false&&!p.isEgg&&p.heldItem!==195&&nationalSpeciesId(p.species)===rule.fromSpecies&&!protectedFingerprints.includes(encounterFingerprint(p)));
  if(!pokemon)continue;
  if(rule.trigger==='level-up'&&pokemon.level>=100)continue;
  if(rule.personalityRemainders&&!rule.personalityRemainders.includes((pokemon.personality>>>rule.personalityShift)%rule.personalityModulus))continue;
  if(rule.relativeStats!==undefined&&(!canSupply(68)||projectedTyrogueBranch(pokemon,Math.max(rule.level,pokemon.level+1))!==rule.relativeStats))continue;
  const stocked=rule.item&&Object.values(trainer.bag??{}).flat().some(i=>i.itemId===rule.item.nativeId&&i.quantity>0);
  if(rule.item&&!stocked&&!canSupply(rule.item.nativeId))continue;
  options.push({pokemon,rule,rank:stocked?0:rule.trigger==='level-up'?1+Math.max(0,(rule.level??pokemon.level+1)-pokemon.level)+(rule.friendship?Math.max(0,rule.friendship-pokemon.friendship):0):2});
 }
 return options.sort((a,b)=>a.rank-b.rank);
}
// Partner availability published by the host. The legacy `true` means the
// Emerald companion; an availability document lists each ready partner owner.
// A FireRed partner (a second FireRed save) serves only trade evolutions.
const EMERALD_PARTNER=Object.freeze({owner:'emerald',title:'emerald',methods:Object.freeze(['trade','time','beauty'])});
export function availablePartners(available){
 if(available===true)return [EMERALD_PARTNER];
 if(available?.available!==true||!Array.isArray(available.partners))return [];
 return available.partners.filter(p=>/^[a-zA-Z0-9_-]{1,100}$/.test(p?.owner??'')&&p.owner!=='firered'&&(p.title==='emerald'&&p.owner==='emerald'||p.title==='firered'))
  .map(p=>p.title==='emerald'?EMERALD_PARTNER:{owner:p.owner,title:'firered',methods:['trade']});
}
// Emerald stays first whenever it is ready, so its qualified routes are unchanged.
const partnerFor=(rule,available)=>availablePartners(available).find(p=>p.methods.includes(rule.trigger==='trade'?'trade':rule.beauty?'beauty':'time')&&(p.title==='emerald'||rule.trigger==='trade'))??null;
// Pair-dependent link prerequisites (both saves; the partner reports its own).
// Emerald needs the National Dex and Celio's link. A FireRed partner needs the
// Pokédex (the League implies it), plus the National Dex only when the source
// or evolved species is outside #1–151 (CanTradeSelectedMon in trade.c).
export function partnerTradeReady(flags,step){
 const f=flags??{};
 if(step?.toGame!=='firered'||step.partner===undefined)return f[2112]===true&&f[2116]===true;
 const national=[step.speciesId,step.evolution?.speciesId].some(id=>Number.isInteger(id)&&id>151);
 return (f[2089]===true||f[2092]===true)&&(!national||f[2112]===true);
}
// The partner round trip: equip a held trade item from the bag if needed, trade
// to the partner (evolving there), trade back and verify. Null without the item.
function partnerSteps(rule,pokemon,trainer,partner=EMERALD_PARTNER){
 const steps=[];
 if(rule.heldItem&&pokemon.heldItem!==rule.heldItem.nativeId){
  if(!Object.values(trainer.bag??{}).flat().some(i=>i.itemId===rule.heldItem.nativeId&&i.quantity>0))return null;
  steps.push({kind:'equip-evolution-item',game:'firered',item:rule.heldItem});
 }
 if(partner.title==='firered'){
  if(rule.trigger!=='trade')return null;
  steps.push({kind:'trade',fromGame:'firered',toGame:'firered',partner:partner.owner,speciesId:rule.fromSpecies,evolution:rule},
   {kind:'trade',fromGame:'firered',toGame:'firered',partner:partner.owner,speciesId:rule.speciesId},{kind:'verify',game:'firered',speciesId:rule.speciesId});
  return steps;
 }
 steps.push({kind:'trade',fromGame:'firered',toGame:'emerald',speciesId:rule.fromSpecies,...(rule.trigger==='trade'?{evolution:rule}:{})});
 if(rule.trigger!=='trade')steps.push({kind:'evolve',game:'emerald',fromSpecies:rule.fromSpecies,speciesId:rule.speciesId});
 steps.push({kind:'trade',fromGame:'emerald',toGame:'firered',speciesId:rule.speciesId},{kind:'verify',game:'firered',speciesId:rule.speciesId});
 return steps;
}
export function selectOwnedPartnerEvolution({trainer,partnerAvailable=false,protectedFingerprints=[]}){
 if(!availablePartners(partnerAvailable).length||trainer?.partyValidity!=='valid'||trainer.storage?.validity!=='valid')return null;
 const protectedIds=new Set([...protectedFingerprints,...trainer.party.map(encounterFingerprint)]),owned=new Set((trainer.pokedex?.ownedSpecies??[]).map(nationalSpeciesId));
 for(const rule of rulesDocument.rules){
  if(owned.has(rule.speciesId)||!(rule.trigger==='trade'||rule.evolutionGame==='emerald'||rule.beauty))continue;
  const partner=partnerFor(rule,partnerAvailable);if(!partner)continue;
  const pokemon=trainer.storage.pokemon.find(p=>p.validity==='valid'&&p.shiny===false&&!p.isEgg&&p.heldItem!==195&&nationalSpeciesId(p.species)===rule.fromSpecies&&!protectedIds.has(encounterFingerprint(p))&&(!(rule.beauty||rule.evolutionGame)||p.level<100)&&(!rule.beauty||Number.isInteger(p.beauty)&&Number.isInteger(p.sheen)&&(p.beauty>=170||p.sheen<255)));
  const steps=pokemon&&partnerSteps(rule,pokemon,trainer,partner);
  if(!steps)continue;
  return {requestId:`dex-partner-${pokemon.otId}-${pokemon.personality}-${rule.speciesId}`,sourceId:'owned-national-dex',pokemon,steps,automatic:true,request:{game:'firered',speciesId:rule.speciesId,quantity:1,shiny:'any'}};
 }
 return null;
}
// Permanent teammates with a trade evolution (Machoke, Kadabra, Graveler,
// Haunter, or a held-item trade) make the same round trip so the team reaches
// its evolved form, whether or not that species is registered. The evolved
// species must stay in the member's permanent family; without a campaign plan
// the whole party is the team. Shinies and Everstone holders stay home.
export function selectTeamPartnerEvolution({trainer,partnerAvailable=false,teamPlan=null,protectedFingerprints=[]}){
 if(!availablePartners(partnerAvailable).length||trainer?.partyValidity!=='valid'||trainer.storage?.validity!=='valid')return null;
 const protectedIds=new Set(protectedFingerprints),families=teamPlan?.permanentFamilies;
 for(const pokemon of trainer.party){
  if(pokemon.validity!=='valid'||pokemon.shiny!==false||pokemon.isEgg||pokemon.heldItem===195||protectedIds.has(encounterFingerprint(pokemon)))continue;
  const species=nationalSpeciesId(pokemon.species),family=families?.find(f=>f.includes(species));
  if(families&&!family)continue;
  for(const rule of rulesDocument.rules){
   if(rule.trigger!=='trade'||rule.fromSpecies!==species||family&&!family.includes(rule.speciesId))continue;
   const partner=partnerFor(rule,partnerAvailable),steps=partner&&partnerSteps(rule,pokemon,trainer,partner);
   if(steps)return {requestId:`team-partner-${pokemon.otId}-${pokemon.personality}-${rule.speciesId}`,sourceId:'permanent-team',pokemon,steps,automatic:true,request:{game:'firered',speciesId:rule.speciesId,quantity:1,shiny:'any'}};
  }
 }
 return null;
}
export function resolveSavedEvolutionSource({sourceSpeciesId,proofs,trainer}){
 if(trainer?.partyValidity!=='valid'||trainer.storage?.validity!=='valid')throw Error('Verify the current party and storage before evolution.');
 const matches=[...trainer.party,...trainer.storage.pokemon].filter(p=>nationalSpeciesId(p.species)===sourceSpeciesId&&proofs.some(proof=>encounterFingerprint(p)===encounterFingerprint(proof)));
 if(matches.length!==1)throw Error('The saved source identity is missing, ambiguous, or already in another task.');
 return matches[0];
}

// Tyrogue's evolution reads the recalculated stats after the level-up.
export function projectedTyrogueBranch(p,level){
 const nature=p.personality%25,up=Math.floor(nature/5),down=nature%5;
 const stat=(key,index)=>{
  if(!Number.isInteger(p.ivs?.[key])||!Number.isInteger(p.evs?.[key]))return NaN;
  const base=Math.floor((70+p.ivs[key]+Math.floor(p.evs[key]/4))*level/100)+5;
  return Math.floor(base*(up===down?100:up===index?110:down===index?90:100)/100);
 };
 const a=stat('attack',0),d=stat('defense',1);
 return Number.isFinite(a)&&Number.isFinite(d)?Math.sign(a-d):null;
}

// Recommendations are consumed by the existing observed-menu input mapper.
export function evolutionItemRecommendation(o,objective){
 const t=objective?.target,ui=o.playerMemory?.ui??{};
 if(!['evolve-with-item','use-party-item','give-held-item','take-held-item','lead-party-member'].includes(t?.kind)||!t.fingerprint||o.emulator?.inBattle)return null;
 const matches=(o.playerMemory?.trainer?.party??[]).filter(p=>encounterFingerprint(p)===t.fingerprint);
 if(matches.length!==1)return {kind:'stop-for-review',reason:'Evolution item target is missing or duplicated.'};
 const p=matches[0],itemId=t.itemId,take=t.kind==='take-held-item',lead=t.kind==='lead-party-member';
 const choose={kind:'choose-party-member',targetPartySlot:p.slot,targetSpecies:p.species,objective:objective.id};
 if(lead){
  if(p.slot===0)return ui.party||ui.startMenu?{kind:'close-menu'}:null;
  if(ui.party?.stage==='choose-switch-target'){
   const current=o.playerMemory.trainer.party.find(q=>q.slot===0);
   return current?{...choose,targetPartySlot:0,targetSpecies:current.species}:null;
  }
  if(ui.party?.stage==='selection-menu'){
   if(ui.party.selectedPartySlot!==p.slot)return {kind:'close-menu'};
   const index=ui.party.actions?.indexOf('switch')??-1;
   return index>=0?{kind:'choose-party-action',targetAction:'switch',targetIndex:index}:{kind:'close-menu'};
  }
  if(ui.party)return choose;
  if(ui.bag)return {kind:'close-menu'};
 }
 if(ui.party?.stage==='message')return {kind:'acknowledge-cartridge-prompt'};
 if(ui.choiceMenu)return {kind:'choose-menu-option',targetOption:'no'};
 // An unexpected held-item switch keeps the current item; Mail prompts belong to their own task.
 if(/^confirm-/.test(ui.party?.stage??''))return ui.party.stage==='confirm-switch-item'?{kind:'choose-menu-option',targetOption:'no',targetIndex:1}:{kind:'stop-for-review',reason:'A Mail prompt belongs to the Mail transaction.'};
 if(take&&ui.party?.stage==='selection-menu'){
  if(ui.party.selectedPartySlot!==p.slot)return {kind:'close-menu'};
  const action=ui.party.actions?.includes('take-item')?'take-item':'item',index=ui.party.actions?.indexOf(action)??-1;
  return index>=0?{kind:'choose-party-action',targetAction:action,targetIndex:index}:{kind:'close-menu'};
 }
 if(ui.party)return take||ui.party.itemId===itemId?choose:{kind:'close-menu'};
 // FireRed keeps berries in the Berry Pouch, a Key Item: Key Items > Berry
 // Pouch > Open > berry > Give/Use. There is no fifth Bag pocket.
 const bag=o.playerMemory.trainer.bag??{},berry=(bag.berries??[]).some(i=>i.itemId===itemId&&i.quantity>0);
 if(ui.bag?.stage==='berry-pouch-context'){
  const action=t.kind==='give-held-item'?'give':'use',index=ui.bag.actions?.indexOf(action)??-1;
  return ui.bag.selectedItemId===itemId&&index>=0?{kind:'choose-bag-context-action',targetAction:action,targetIndex:index}:{kind:'close-menu'};
 }
 if(ui.bag?.stage==='berry-pouch-list'){
  const index=(bag.berries??[]).findIndex(i=>i.itemId===itemId&&i.quantity>0);
  return index>=0?{kind:'choose-bag-item',targetItemId:itemId,targetIndex:index}:{kind:'close-menu'};
 }
 if(berry&&ui.bag?.stage==='context')return ui.bag.selectedItemId===ITEM_BERRY_POUCH?{kind:'choose-bag-context-action',targetAction:'open',targetIndex:0}:{kind:'close-menu'};
 if(berry&&ui.bag?.stage==='list'){
  if(ui.bag.pocket!==1)return {kind:'choose-bag-pocket',targetPocket:1};
  const index=(bag.keyItems??[]).findIndex(i=>i.itemId===ITEM_BERRY_POUCH);
  return index>=0?{kind:'choose-bag-item',targetItemId:ITEM_BERRY_POUCH,targetIndex:index}:{kind:'stop-for-review',reason:'The Berry Pouch is missing from Key Items.'};
 }
 if(ui.bag?.stage==='context')return ui.bag.selectedItemId===itemId?{kind:'choose-bag-context-action',targetAction:t.kind==='give-held-item'?'give':'use',targetIndex:t.kind==='give-held-item'?1:0}:{kind:'close-menu'};
 if(ui.bag?.stage==='list'){
  const pocket=0;
  if(ui.bag.pocket!==pocket)return {kind:'choose-bag-pocket',targetPocket:pocket};
  const index=(bag.items??[]).findIndex(i=>i.itemId===itemId&&i.quantity>0);
  return index>=0?{kind:'choose-bag-item',targetItemId:itemId,targetIndex:index}:{kind:'close-menu'};
 }
 if(ui.startMenu){const item=take||lead?'pokemon':'bag',index=ui.startMenu.order?.indexOf(item)??-1;return index>=0?{kind:'choose-start-menu-item',targetItem:item,targetIndex:index}:{kind:'stop-for-review',reason:'Required party item menu is unavailable.'};}
 return o.emulator?.mode==='overworld'?{kind:'open-start-menu'}:null;
}

export class FireRedEvolutionTask{
 constructor({requestId,sourceId,pokemon,steps,request,state=null}){
  if(state){if(state.schema!=='pokemon-suite/firered-evolution/v1'||state.requestId!==requestId)throw Error('Evolution checkpoint belongs to another task.');this.state=structuredClone(state);return;}
  if(!lineage(pokemon)||pokemon.isEgg||!Array.isArray(steps)||!steps.length||!requestId||!sourceId)throw Error('Evolution needs an identified, saved source Pokémon and route.');
  for(const step of steps)if(step.kind==='evolve'&&step.game==='firered'&&!ruleFor(step.fromSpecies,step.speciesId))throw Error('The requested evolution is absent from the original FireRed cartridge.');
  this.state={schema:'pokemon-suite/firered-evolution/v1',requestId,sourceId,originalPokemon:structuredClone(pokemon),lineage:lineage(pokemon),steps:structuredClone(steps.filter(s=>s.kind!=='acquire')),request:structuredClone(request),index:0,phase:'preparing',progress:null,baseline:null,receipts:[]};
 }
 acceptRoundTrip(result,o){
  const s=this.state,r=result.reservation;
  if(r?.requestId!==s.requestId||r.index!==s.index||JSON.stringify(r.steps)!==JSON.stringify(s.steps.slice(s.index,r.throughIndex+1))||!sameEvolutionIndividual(s.originalPokemon,r.source))throw Error('The completed round trip does not match this evolution step.');
  verifyLocalEvolutionExchange(r,'outbound',result.outbound);
  const p=verifyLocalEvolutionExchange(r,'return',result.returned),e=result.evolution;
  if(r.method!=='trade'&&(!e?.nativeSaveVerified||e.requestId!==s.requestId||e.game!=='emerald'||!sameEvolutionIndividual(p,e.pokemon)||p.species!==e.pokemon.species||!/^[a-f0-9]{64}$/.test(e.savedSramSha256??'')))throw Error('The receiving-game evolution save is not verified.');
  const current=o.playerMemory?.trainer?.party?.filter(q=>encounterFingerprint(q)===encounterFingerprint(p));
  if(!field(o)||o.playerMemory.trainer.partyValidity!=='valid'||current?.length!==1||o.sram?.sha256!==(result.returned.source??result.returned.firered)?.savedSramSha256)throw Error('The returned individual is not verified in the current FireRed native save.');
  s.receipt={requestId:s.requestId,sourceId:s.sourceId,pokemon:structuredClone(current[0]),nationalSpeciesId:nationalSpeciesId(p.species),fingerprint:encounterFingerprint(p),originalFingerprint:encounterFingerprint(s.originalPokemon),nativeSaveVerified:true,savedSramSha256:o.sram.sha256,savedFrame:o.frame,roundTrip:structuredClone(result)};
  s.receipts.push({...s.receipt,index:s.index});s.index=r.throughIndex+1;s.baseline=null;s.phase='preparing';s.reason=null;s.currentFingerprint=encounterFingerprint(p);
 }
 inspect(o,options={}){
  const s=this.state,m=o.playerMemory??{},ui=m.ui??{},t=m.trainer??{};
  const CENTER=fireRedPokemonCenter(m.map?.id);
  const policy=(id,target,extra={})=>({kind:'policy',objective:{id:`evolution-${s.requestId}-${id}`,target,dialogue:'advance',choice:'yes',deferOptionalDetours:true,identityEvolution:true,...extra}});
  const stop=reason=>{s.phase='waiting';s.reason=reason;return {kind:'stop',reason};};
  const external=(game,reason)=>{s.phase='waiting-for-transfer';s.reason=reason;return {kind:'external',game,reason,step:s.steps[s.index]};};
  if(s.phase==='complete')return {kind:'complete',receipt:s.receipt};
  if(o.phase!=='stable'||t.partyValidity!=='valid'||t.storage?.validity!=='valid')return {kind:'wait'};
  const all=[...(t.party??[]),...(t.storage.pokemon??[])],family=all.filter(p=>lineage(p)===s.lineage);
  if(ui.storage)return policy('withdraw',{kind:'party-roster',map:CENTER,minimumPartySize:1,maximumPartySize:s.partyMaximum??6,requiredFingerprints:[s.currentFingerprint??encounterFingerprint(s.originalPokemon),...(s.expShareHolder?[s.expShareHolder]:[])]});
  const step=s.steps[s.index];
  if(!step){s.phase='complete';return {kind:'complete',receipt:s.receipt};}
  const rule=step.kind==='evolve'?ruleFor(step.fromSpecies,step.speciesId):null;
  // An equip step names no species; its source is the next step's species
  // (the outbound trade), so retained routes resolve the same individual.
  const stepSpecies=step.speciesId??s.steps.slice(s.index).find(x=>Number.isInteger(x.speciesId))?.speciesId;
  const matches=family.filter(p=>nationalSpeciesId(p.species)===(rule?.speciesId??stepSpecies));
  const evolved=rule&&matches.length===1&&s.baseline;
  const p=evolved?matches[0]:family.find(p=>nationalSpeciesId(p.species)===(rule?.fromSpecies??stepSpecies));
  const nativePair=evolved&&rule.fromSpecies===290&&family.length===2&&[291,292].every(id=>family.some(q=>nationalSpeciesId(q.species)===id));
  const expectedFamilySize=nativePair||rule?.extraPartySlot&&evolved?2:1;
  if(!p||family.length!==expectedFamilySize)return stop('The source Pokémon is missing, duplicated, or evolved outside the expected step.');
  if(s.request.shiny==='required'&&p.shiny!==true)return stop('The selected source no longer verifies as shiny.');
  s.currentFingerprint=encounterFingerprint(p);
  if(evolved){
   if(rule.extraPartySlot&&!family.some(q=>nationalSpeciesId(q.species)===rule.additionalSpecies))return stop('The native Ninjask and Shedinja pair is not verified.');
   if(rule.item&&count(o,rule.item.nativeId)!==s.baseline.itemCount-1)return stop('Evolution item consumption is not verified.');
   s.phase='saving';
   if(['error','saving-error'].includes(ui.saveDialog?.stage))return stop('The evolution native save failed.');
   // Training can encounter and save another Pokémon before this evolution.
   // Keep the preparation baseline for item consumption, but require a save
   // strictly after observing the evolved individual. Old checkpoints also
   // acquire this proof instead of trusting an unrelated earlier save.
   if(!s.evolutionSave){
    if(!Number.isSafeInteger(m.gameStats?.savedGame)||!o.sram?.sha256)return stop('The post-evolution save baseline is unavailable.');
    s.evolutionSave={counter:m.gameStats.savedGame,sha256:o.sram.sha256,frame:o.frame};
   }
   // The shared Exp. Share returns to the bag for the next trainee before the save.
   if(s.expShareUsed&&p.heldItem===182)return policy('return-exp-share',{kind:'take-held-item',fingerprint:encounterFingerprint(p),map:m.map.id,itemId:182});
   const verified=m.saveAttemptStatus===1&&m.gameStats?.savedGame===s.evolutionSave.counter+1&&o.sram?.sha256!==s.evolutionSave.sha256;
   if(!verified||!field(o))return policy('save',{kind:'save-game',map:m.map.id,saveVerified:verified});
   s.receipt={requestId:s.requestId,sourceId:s.sourceId,pokemon:structuredClone(p),nationalSpeciesId:nationalSpeciesId(p.species),fingerprint:encounterFingerprint(p),originalFingerprint:encounterFingerprint(s.originalPokemon),nativeSaveVerified:true,nativeSaveAfterEvolution:true,evolutionObservedFrame:s.evolutionSave.frame,savedSramSha256:o.sram.sha256,savedFrame:o.frame};
   s.receipts.push({...s.receipt,index:s.index});s.index++;s.baseline=null;s.evolutionSave=null;s.trainingLevel=null;s.partyMaximum=null;s.phase='preparing';
   return this.inspect(o);
  }
  if(step.kind==='verify'){
   if(s.dirty){
    s.phase='saving';
    if(!s.finalSave){
     if(!field(o))return policy('drain-final-menu',{kind:'map',map:m.map.id});
     if(!Number.isSafeInteger(m.gameStats?.savedGame)||!o.sram?.sha256)return stop('The final native save baseline is unavailable.');
     s.finalSave={counter:m.gameStats.savedGame,sha256:o.sram.sha256};
    }
    const verified=m.saveAttemptStatus===1&&m.gameStats?.savedGame===s.finalSave.counter+1&&o.sram?.sha256!==s.finalSave.sha256;
    if(['error','saving-error'].includes(ui.saveDialog?.stage))return stop('The final setup native save failed.');
    if(!verified||!field(o))return policy('save-final-setup',{kind:'save-game',map:m.map.id,saveVerified:verified});
    s.receipt={...s.receipt,pokemon:structuredClone(p),savedSramSha256:o.sram.sha256,savedFrame:o.frame};s.dirty=false;s.finalSave=null;
   }
   if(!s.receipt?.nativeSaveVerified||s.receipt.fingerprint!==encounterFingerprint(p))return stop('The final native evolution save has not been verified.');
   if(s.request.finalLevel!=null&&p.level!==s.request.finalLevel)return stop('The final requested level has not been verified.');
   if(s.request.moves?.some(id=>!p.moves?.includes(id)))return stop('The final requested moves have not been verified.');
   s.index++;return this.inspect(o);
  }
  if(step.kind==='trade'){
   const tradeRule=step.evolution&&ruleFor(step.evolution.fromSpecies,step.evolution.speciesId);
   if(tradeRule?.removeEverstone&&p.heldItem===195){
    if(!(t.party??[]).some(q=>encounterFingerprint(q)===encounterFingerprint(p)))return policy('withdraw',{kind:'party-roster',map:CENTER,minimumPartySize:2,maximumPartySize:6,requiredFingerprints:[encounterFingerprint(p)],requiredFamilies:t.party.filter(q=>q.moves?.includes(19)).map(q=>[q.species])});
    return policy('remove-trade-everstone',{kind:'take-held-item',fingerprint:encounterFingerprint(p),map:m.map.id,itemId:195});
   }
   if(tradeRule?.heldItem&&p.heldItem!==tradeRule.heldItem.nativeId)return stop('The held item required for this trade evolution is not equipped.');
   return external(step.toGame,'A separate compatible game must complete the native trade, both saves, and normal link exit.');
  }
  if(step.game!=='firered')return external(step.game,'Continue this individual’s evolution in its required game, then return it to FireRed.');
  if(rule?.evolutionGame)return external(rule.evolutionGame,'FireRed disables Eevee’s time evolutions. Trade this Eevee to Emerald before friendship training.');
  if(rule?.beauty&&p.beauty<rule.beauty)return external('emerald',p.sheen>=255?'Feebas is below the Beauty threshold with maximum Sheen; this individual needs a reviewed recovery plan.':'Feebas needs dry Pokéblocks in Emerald to reach Beauty 170 before returning for a level-up.');
  if(rule?.nationalDexRequired&&m.storyState?.flagIds?.[2112]!==true){s.phase='national-dex';return {kind:'national-dex'};}
  if(rule?.personalityRemainders&&!rule.personalityRemainders.includes((p.personality>>>rule.personalityShift)%rule.personalityModulus))return stop('This Wurmple’s fixed personality produces the other branch. Preserve this shiny and acquire another suitable source.');
  if(rule?.trigger==='level-up'&&p.level>=100)return stop('FireRed cannot trigger a level-up evolution at level 100.');
  const member=(t.party??[]).find(q=>encounterFingerprint(q)===encounterFingerprint(p));
  s.partyMaximum=rule?.extraPartySlot?5:6;
  if(!member||t.party.length>s.partyMaximum)return policy('withdraw',{kind:'party-roster',map:CENTER,minimumPartySize:1,maximumPartySize:s.partyMaximum,requiredFingerprints:[encounterFingerprint(p)],requiredFamilies:t.party.filter(q=>q.moves?.includes(19)).map(q=>[q.species])});
  const itemStep=['equip-evolution-item','equip-final-item'].includes(step.kind);
  if(itemStep&&p.heldItem===step.item.nativeId){s.index++;return this.inspect(o);}
  if((rule&&p.heldItem===195)||(itemStep&&p.heldItem!==0))return policy('remove-item',{kind:'take-held-item',fingerprint:encounterFingerprint(p),map:m.map.id,itemId:p.heldItem});
  if(itemStep){
   if(!Number.isInteger(step.item?.nativeId))return stop('The requested held item has no verified FireRed item ID.');
   if(count(o,step.item.nativeId)<1)return {kind:'supply',item:step.item};
   s.dirty=true;return policy('give-item',{kind:'give-held-item',map:m.map.id,fingerprint:encounterFingerprint(p),itemId:step.item.nativeId});
  }
  if(step.kind==='train-final-level'){
   if(p.level>step.level)return stop('The individual is already above the requested final level.');
   if(p.level===step.level){s.index++;return this.inspect(o);}
   s.dirty=true;s.phase='training-final-level';
   if(count(o,68)>0)return policy('final-level-candy',{kind:'use-party-item',map:m.map.id,fingerprint:encounterFingerprint(p),itemId:68});
   return policy('final-level-training',{kind:'map',map:m.map.id},{minimumCoreLevel:step.level,coreSpecies:[p.species],trainingFingerprint:encounterFingerprint(p)});
  }
  if(!rule)return stop('The remaining final setup step needs its native executor.');
  if(rule.trigger==='trade')return external('gen3-partner','This evolution requires a completed native trade to a separate compatible game.');
  if(rule.friendship&&(!Number.isInteger(p.friendship)||p.friendship<rule.friendship)){
   if(!Number.isInteger(p.friendship))return stop('The current friendship value is unreadable.');
   s.phase='friendship';s.progress={friendship:p.friendship,required:rule.friendship};
   return policy('friendship',{kind:'friendship-walk',map:CENTER,fingerprint:encounterFingerprint(p)});
  }
  if(rule.relativeStats!==undefined&&projectedTyrogueBranch(p,Math.max(rule.level,p.level+1))!==rule.relativeStats){
   const total=IVS.reduce((sum,k)=>sum+Number(p.evs?.[k]??0),0),plans=[];
   for(let attack=0;attack<=10;attack++)for(let defense=0;defense<=10;defense++){
    const a=Math.min(100,p.evs.attack+attack*10),d=Math.min(100,p.evs.defense+defense*10);
    if(a<p.evs.attack||d<p.evs.defense||total+a-p.evs.attack+d-p.evs.defense>510||!attack&&!defense)continue;
    if(projectedTyrogueBranch({...p,evs:{...p.evs,attack:a,defense:d}},Math.max(rule.level,p.level+1))===rule.relativeStats)plans.push({attack,defense});
   }
   plans.sort((a,b)=>a.attack+a.defense-b.attack-b.defense);
   const plan=plans[0];
   if(!plan)return stop('Tyrogue’s branch needs additional EV training; the current vitamin limits cannot produce the requested stats safely.');
   const itemId=plan.attack?64:65;s.phase='preparing-stats';
   if(count(o,itemId)<1)return {kind:'supply',item:{nativeId:itemId,name:plan.attack?'Protein':'Iron'}};
   return policy('prepare-stats',{kind:'use-party-item',map:m.map.id,fingerprint:encounterFingerprint(p),itemId});
  }
  if(rule.relativeStats!==undefined&&count(o,68)<1)return {kind:'supply',item:{nativeId:68,name:'Rare Candy'}};
  if(rule.item&&count(o,rule.item.nativeId)<1)return {kind:'supply',item:rule.item};
  if(!s.baseline){
   if(!field(o))return policy('drain-menu',{kind:'map',map:m.map.id});
   if(!Number.isSafeInteger(m.gameStats?.savedGame)||!o.sram?.sha256)return stop('The native save baseline is unavailable.');
   s.baseline={counter:m.gameStats.savedGame,sha256:o.sram.sha256,itemCount:rule.item?count(o,rule.item.nativeId):null};
   s.trainingLevel=Math.max(rule.level??0,p.level+1);
  }
  s.phase='evolving';s.progress={level:p.level,required:s.trainingLevel,friendship:p.friendship};
  if(rule.item)return policy('use-item',{kind:'evolve-with-item',map:m.map.id,fingerprint:encounterFingerprint(p),itemId:rule.item.nativeId});
  const candy=candyWorthwhile(p,rule,options);
  if(candy&&count(o,68)>0)return policy('use-item',{kind:'use-party-item',map:m.map.id,fingerprint:encounterFingerprint(p),itemId:68});
  const level=candyLevel(p);
  // A renewable supply (question-mark Mail) serves every level; a finite one only expensive, fresh levels.
  if((options.renewableCandies||level?.expensive&&level.fresh)&&options.canSupply?.(68))return {kind:'supply',item:{nativeId:68,name:'Rare Candy'}};
  // The owned Exp. Share rides with the trainee. From the PC, its holder is
  // withdrawn with the trainee; the training objective then moves the item.
  const shareHeld=count(o,182)>0||(t.party??[]).some(q=>q.heldItem===182);
  const shareHolder=shareHeld?null:(t.storage.pokemon??[]).find(q=>q.validity==='valid'&&!q.isEgg&&q.heldItem===182);
  s.expShareHolder=shareHolder?encounterFingerprint(shareHolder):null;
  if(shareHolder)return policy('withdraw-exp-share',{kind:'party-roster',map:CENTER,minimumPartySize:2,maximumPartySize:s.partyMaximum,requiredFingerprints:[encounterFingerprint(p),s.expShareHolder],requiredFamilies:t.party.filter(q=>q.moves?.includes(19)).map(q=>[q.species])});
  if(shareHeld)s.expShareUsed=true;
  return policy('train',{kind:'map',map:m.map.id},{minimumCoreLevel:s.trainingLevel,coreSpecies:[p.species],trainingFingerprint:encounterFingerprint(p)});
 }
}
