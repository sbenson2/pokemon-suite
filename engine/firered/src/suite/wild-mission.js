import {encounterFingerprint} from '../player/encounter-tracker.js';
import {validateHuntConfig} from '../player/hunt-config.js';
import {knownCaptureFreeSlots} from '../player/encounter-safety.js';
import {buildPokeBallMartCatalog,campaignNavigationWatch} from '../player/campaign.js';
import {planFireRedBallSupply,fireRedBallShopUpgrade,FIRE_RED_SHOP_BALL_IDS,BALL_SUPPLY_PROFILE} from './ball-supplies.js';
import {partyFullyRestored} from '../player/recovery.js';

import {evaluateRngTraits} from '../rng/target-traits.js';
import {unownForm} from '../evidence/unown-form.js';
import {nativeUnownForms} from './postgame-collection-extras.js';
import {supportsFireRedLandRngMethod} from '../rng/fire-red-rng.js';
import {FIRE_RED_RODS} from './national-dex-agenda.js';

const BALLS={'master-ball':1,'ultra-ball':2,'great-ball':3,'poke-ball':4};
const shops={2:'MAP_FUCHSIA_CITY_MART',3:'MAP_SAFFRON_CITY_MART',4:'MAP_VIRIDIAN_CITY_MART'};
const prices={2:1200,3:600,4:200};
const martOpen=o=>Boolean(o.playerMemory?.ui?.mart||/BuyMenu/.test(o.emulator?.callback2??''));
function validateWildRoute(r,route,world,mechanics){
 if(r.game!=='firered'||!route||!['wild-land','safari-land','fishing'].includes(route.method))throw new Error('Choose a supported FireRed land or fishing route.');
 if(!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>99)throw new Error('Choose a quantity from 1 to 99.');
 if(r.moves?.length||r.heldItemId!=null||r.finalLevel!=null)throw new Error('Wild hunts save Pokémon as caught.');
 if(route.speciesId!==r.speciesId||(r.locationId!=='any'&&route.locationId!==r.locationId))throw new Error('The encounter location does not match the request.');
 if(route.unownForm!==undefined&&(r.speciesId!==201||!Number.isInteger(route.unownForm)||route.unownForm<0||route.unownForm>27))throw Error('Choose a native Unown form from 0 through 27.');
 if(route.unownForm!==undefined&&!nativeUnownForms(route.map).includes(route.unownForm))throw Error('The requested Unown form does not occur in this native chamber.');
 const safari=/^MAP_SAFARI_ZONE_(NORTH|SOUTH|EAST|WEST|CENTER)$/.test(route.map);
 if(route.method==='fishing'){
  // A fishing hunt names the rod whose native table slots hold the species
  // (pokefirered src/wild_encounter.c: slots 0-1 Old, 2-4 Good, 5-9 Super Rod).
  const rod=FIRE_RED_RODS.find(x=>x.itemId===route.rodItemId);
  if(!rod)throw new Error('Choose the fishing rod for this route.');
  if(safari||route.unownForm!==undefined)throw new Error('Choose a supported FireRed fishing route.');
  if(r.ball.requirement==='required'&&!['any',...Object.keys(BALLS)].includes(r.ball.id))throw new Error('The required ball is incompatible with this route.');
  const species=(mechanics.data??mechanics).species?.find(s=>s.id===(route.nativeSpecies??r.speciesId));
  const table=world?(world.data??world).wildEncounters?.find(t=>t.map===route.map&&t.base_label.endsWith('_FireRed'))?.fishing_mons?.mons:null;
  if(!table?.slice(rod.start,rod.end).some(s=>s.species===species?.name&&s.min_level<=r.encounterLevel.max&&s.max_level>=r.encounterLevel.min))throw new Error(`The current cartridge has no matching ${rod.name} fishing encounter.`);
  return;
 }
 if(safari!==(route.method==='safari-land'))throw new Error('Encounter table and capture method disagree.');
 if(r.ball.requirement==='required'&&!(safari?['any','safari-ball']:['any',...Object.keys(BALLS)]).includes(r.ball.id))throw new Error('The required ball is incompatible with this route.');
 if(world){
  const species=(mechanics.data??mechanics).species?.find(s=>s.id===(route.nativeSpecies??r.speciesId));
  const table=(world.data??world).wildEncounters?.find(t=>t.map===route.map&&t.base_label.endsWith('_FireRed'))?.land_mons?.mons;
  if(!table?.some(s=>s.species===species?.name&&s.min_level<=r.encounterLevel.max&&s.max_level>=r.encounterLevel.min))throw new Error('The current cartridge has no matching land encounter table.');
 }else if(r.speciesId!==113||route.map!=='MAP_SAFARI_ZONE_NORTH')throw new Error('The current cartridge encounter table is required.');
}

export class WildMission{
 constructor({id,request,state=null,route=null,world=null,story=null,mechanics={},fundingPlanner=null}){
  route={...route,...state?.route};validateWildRoute(request,route,world,mechanics);
  this.mechanics=mechanics;this.world=world;this.nativeSpecies=route.nativeSpecies??request.speciesId;
  this.ballShops=world&&story?buildPokeBallMartCatalog(world,story):null;
  this.fundingPlanner=fundingPlanner;
  this.request=request;
  this.state=state?structuredClone(state):{id,method:route.method,phase:'traveling',encounters:0,resets:0,repeated:0,recent:[],elapsedMs:0,protected:false,route:structuredClone(route),caught:0,captures:[],visits:0};
  this.state.route=structuredClone(route);
  if(this.state.id!==id)throw new Error('Wild hunt checkpoint belongs to another hunt.');
 }
 storyWatch(){
  const watch=campaignNavigationWatch(this.state.route.map),rod=this.rod();
  return rod?{...watch,flags:[...new Set([...(watch.flags??[]),rod.flagId])]}:watch;
 }
 rod(){return this.state.method==='fishing'?FIRE_RED_RODS.find(x=>x.itemId===this.state.route.rodItemId)??null:null;}
 // The rod the route names, collected legitimately from its giver when the
 // save has not received it yet (a one-time gift; its flag stays set).
 rodPreparation(o){
  const rod=this.rod();if(!rod)return null;
  const m=o.playerMemory??{},owned=Object.values(m.trainer?.bag??{}).flat().some(i=>i?.itemId===rod.itemId&&i.quantity>0);
  if(owned)return null;
  if(m.storyState?.flagIds?.[rod.flagId]!==false)return {kind:'stop',reason:`The ${rod.name} is recorded as received but is not in the Bag.`};
  const index=(this.world?.data??this.world)?.maps?.find(x=>x.id===rod.map)?.objectEvents?.findIndex(e=>e.script===rod.script)??-1;
  if(index<0)return {kind:'stop',reason:`The ${rod.name} giver is not in the current cartridge.`};
  this.state.phase='collecting-rod';
  return {kind:'policy',objective:{id:'hunt-collect-rod',target:{kind:'object',map:rod.map,index},completion:{kind:'flag-set',id:rod.flagId},dialogue:'advance',choice:'yes',deferOptionalDetours:true}};
 }
 initialize(o){
  if(o.playerMemory?.trainer?.partyValidity!=='valid'||!Number.isSafeInteger(o.playerMemory.trainer.money))throw new Error('The current party and money could not be verified.');
  if(!(knownCaptureFreeSlots(o.playerMemory.trainer)>0))throw new Error('Capture needs verified free storage.');
  this.state.initialMoney??=o.playerMemory.trainer.money;
 }
 capturePolicy(){return {...validateHuntConfig({observeOnly:false,onShiny:'capture',onTarget:'capture',targets:[{required:this.state.utilityCapture?{species:[43]}:{species:[this.nativeSpecies],...(this.request.shiny==='required'?{shiny:true}:{}),...(Number.isInteger(this.state.route.unownForm)?{unownForms:[this.state.route.unownForm]}:{})}}],limits:{maxIdleFrames:36000,maxCaptureTurns:120}}),area:this.state.utilityCapture?'MAP_ROUTE24':this.state.route.map};}
 captureRequirements(){const safari=this.state.method==='safari-land'&&!this.state.utilityCapture;return {nickname:this.state.utilityCapture?null:this.request.nickname,safari,optimizeCapture:!safari,fightTrappedNonTargets:true,shinyPriority:this.request.shiny==='required',minBalls:safari||this.state.utilityCapture?0:this.request.limits.minBalls,ballIds:safari?[5]:this.state.utilityCapture?[2,3,4]:this.request.ball.requirement==='required'&&BALLS[this.request.ball.id]?[BALLS[this.request.ball.id]]:FIRE_RED_SHOP_BALL_IDS};}
 matches(p){return p?.validity==='valid'&&!p.isEgg&&p.species===this.nativeSpecies&&typeof p.shiny==='boolean'&&(!Number.isInteger(this.state.route.unownForm)||unownForm(p)===this.state.route.unownForm)&&(this.request.shiny==='required'?p.shiny:evaluateRngTraits(p,this.request,this.mechanics).matched);}
 acceptSavedCapture(capture){
  if(!capture?.nativeSaveVerified||!capture.savedSramSha256||!capture.fingerprint)throw new Error('A verified native save is required before the next capture.');
  const s=this.state;s.captures??=[];
  if(!s.captures.some(c=>c.fingerprint===capture.fingerprint))s.captures.push({fingerprint:capture.fingerprint,pokemon:capture.pokemon,savedSramSha256:capture.savedSramSha256,target:this.matches(capture.pokemon)});
  s.caught=s.captures.filter(c=>c.target).length;
  const complete=s.caught>=this.request.quantity;
  if(!complete){s.protected=false;s.protectedAnchor=null;s.capturePlan=null;s.rng=null;s.inEncounter=false;s.phase='traveling';s.foundSpecies=null;s.purchase=null;s.ballSupply=null;s.ballFunding=null;}
  return {complete,caught:s.caught,quantity:this.request.quantity};
 }
 supplies(o){
  const s=this.state,t=o.playerMemory.trainer;
  if(!Array.isArray(t.bag?.pokeBalls))return {kind:'stop',reason:'The current ball inventory could not be verified.'};
  if(this.ballShops&&o.playerMemory.storyState?.flagIds?.[2092]===true&&!(this.request.ball.requirement==='required'&&BALLS[this.request.ball.id])&&!s.purchase){
   const supply=this.mixedSupplies(o);if(supply)return supply;
  }
  const qty=id=>t.bag.pokeBalls.filter(b=>b.itemId===id).reduce((n,b)=>n+b.quantity,0);
  const ids=this.captureRequirements().ballIds,usable=ids.reduce((n,id)=>n+qty(id),0),total=FIRE_RED_SHOP_BALL_IDS.reduce((n,id)=>n+qty(id),0);
  const needed=Math.max(1,Math.min(10,(this.request.quantity-(s.caught??0))*3));
  if(s.purchase&&qty(s.purchase.itemId)>=s.purchase.quantity&&!martOpen(o))s.purchase=null;
  if(!s.purchase&&(usable<needed||total<this.request.limits.minBalls+needed)){
   const id=this.request.ball.requirement==='required'?BALLS[this.request.ball.id]??4:4;
   if(id===1)return {kind:'stop',reason:'Not enough Master Balls for the requested captures.'};
   const budget=Math.min(t.money,this.request.limits.maxSpend-(s.initialMoney-t.money));
   const count=Math.min(Math.max(needed-usable,this.request.limits.minBalls+needed-total),Math.floor(budget/prices[id]));
   if(count<1){if(usable>0&&total>this.request.limits.minBalls)return null;return {kind:'stop',reason:'The capture supply cannot be restocked within the remaining spending limit.'};}
   s.purchase={itemId:id,quantity:qty(id)+count,unitPrice:prices[id],stockIndex:0};
  }
  if(s.purchase){s.phase='stocking-balls';return {kind:'policy',objective:{id:'hunt-stock-balls',target:{kind:'purchase-items',map:shops[s.purchase.itemId],objectIndex:0,items:[s.purchase]},dialogue:'advance'}};}
  return null;
 }
 mixedSupplies(o){
  const s=this.state,m=o.playerMemory,t=m.trainer,qty=id=>t.bag.pokeBalls.filter(b=>b.itemId===id).reduce((n,b)=>n+b.quantity,0);
  if(s.ballSupply?.profile!==BALL_SUPPLY_PROFILE&&!martOpen(o))s.ballSupply=null;
  if(!s.ballSupply&&this.fundingPlanner&&this.request.limits.maxSpend>=400000){
   if(!s.ballFunding){
    // Price the full goal; this is a calculation, never an emulator mutation.
    const full=planFireRedBallSupply({observation:{...o,playerMemory:{...m,trainer:{...t,money:999999}}},shops:this.ballShops,budget:999999});
    s.ballFunding={targetMoney:full?full.cost+full.cashReserve:0,initialMoney:t.money,status:'earning',healed:false};
   }
   const f=s.ballFunding;
   if(t.money<f.targetMoney){
    s.phase='funding-balls';
    const menu=Object.values(m.ui??{}).some(Boolean);
    const critical=t.party.some(p=>p.hp<p.maxHp*.5||p.moves?.some(Boolean)&&Array.isArray(p.pp)&&p.pp.every(pp=>pp===0));
    if(!f.healed||critical||f.healing){
     if(partyFullyRestored(m,this.mechanics)&&!menu){f.healed=true;f.objective??=f.healing;f.healing=null;f.cache=null;}
     else{f.healing??=this.fundingPlanner.selectRecovery(o);if(f.healing)return {kind:'policy',objective:{...f.healing,dialogue:'advance',choice:'yes',deferOptionalDetours:true}};}
    }
    const key=JSON.stringify([m.map?.id,t.money,m.vsSeeker?.batterySteps>=100,m.vsSeeker?.rematchEntries]);
    if(!menu&&o.phase==='stable'&&(key!==f.cache||!f.objective)){f.objective=this.fundingPlanner.selectIncomePreparation(o);f.cache=key;}
    if(f.objective)return {kind:'policy',objective:f.objective};
    if(menu||o.phase!=='stable')return {kind:'wait'};
    return {kind:'stop',reason:'Bulk ball funding needs a verified reachable trainer or rematch.'};
   }
   f.status='funded';
  }
  if(!s.ballSupply){
   const budget=this.request.limits.maxSpend-(s.initialMoney-t.money);
   s.ballSupply=planFireRedBallSupply({observation:o,shops:this.ballShops,budget,opponent:{species:this.nativeSpecies,level:s.route.minLevel},mechanics:this.mechanics});
  }
  const plan=s.ballSupply;if(!plan||plan.completed)return null;
  let step=plan.steps[plan.index];
  while(step&&!martOpen(o)&&step.items.every(i=>qty(i.itemId)>=i.quantity)){step=plan.steps[++plan.index];}
  if(!step){plan.completed=true;return null;}
  s.phase='stocking-balls';
  if(step.map==='MAP_TWO_ISLAND'&&step.items.some(i=>[9,10].includes(i.itemId))){const upgrade=fireRedBallShopUpgrade(o);if(upgrade)return upgrade;}
  return {kind:'policy',objective:{id:'hunt-stock-mixed-balls',target:{kind:'purchase-items',...step},dialogue:'advance',deferOptionalDetours:true}};
 }
 beforeInteraction(){return false;}
 inspect(o,{videoFrame=null}={}){
  const s=this.state,m=o.playerMemory??{},encounter=m.encounter,p=encounter?.pokemon;
  if(o.emulator.inBattle&&encounter?.kind==='wild'){
   if(encounter.validity!=='valid'||p?.validity!=='valid'||typeof p.shiny!=='boolean')return {kind:'wait'};
   const fp=encounterFingerprint(p);
   if(!s.inEncounter){s.inEncounter=true;s.encounters++;if(s.recent.includes(fp))s.repeated++;s.recent=[...s.recent,fp].slice(-1024);}
   if((p.shiny||this.matches(p))&&!s.protected){s.protected=true;s.phase='capturing';s.foundSpecies=p.species;return {kind:'protect',pokemon:p};}
   if(!s.protected&&p.species===43&&p.moves?.includes(230)&&!m.trainer?.party?.some(p=>p.moves?.includes(230))){
    s.protected=true;s.utilityCapture=true;s.phase='catching-sweet-scent-user';return {kind:'protect',pokemon:p};
   }
   if(!s.protected){
    // Ordinary battles use the same native legality and encounter guard as
    // the rest of the bot: escape when legal, fight a known ordinary trapper,
    // and resolve forced replacements. Direct Run inputs bypassed Shadow Tag
    // and left the hunt cycling forever between Run and its failure message.
    if(m.battleTypeFlags!==132)return {kind:'policy'};
    if(o.phase!=='stable')return {kind:'wait'};
    if(m.ui?.battle?.stage==='message')return {kind:'recommendation',recommendation:{kind:'acknowledge-cartridge-prompt',objective:'seek-requested-pokemon'}};
    if(m.ui?.battle?.stage==='action')return {kind:'recommendation',recommendation:m.battleTypeFlags===132?{kind:'choose-safari-command',targetIndex:3,targetAction:'run',objective:'seek-requested-pokemon'}:{kind:'choose-battle-command',targetCommand:'run',objective:'seek-requested-pokemon'}};
    return {kind:'wait'};
   }
  }else if(!o.emulator.inBattle)s.inEncounter=false;
  if(s.protected)return {kind:'capture'};
  if(o.emulator.inBattle&&s.ballFunding?.status==='earning'&&s.ballFunding.objective){s.phase='funding-balls';return {kind:'policy',objective:s.ballFunding.objective};}
  if(s.elapsedMs>=this.request.limits.maxMinutes*60000)return {kind:'stop',reason:'Maximum hunt time reached.'};
  if(!o.emulator.inBattle&&s.encounters>=this.request.limits.maxEncounters)return {kind:'stop',reason:'Maximum encounter limit reached.'};
  if(s.initialMoney-m.trainer?.money>this.request.limits.maxSpend)return {kind:'stop',reason:'Hunt spending limit reached.'};
  if(s.method==='safari-land'&&!o.emulator.inBattle&&m.safari?.balls===0&&m.trainer?.money<500)return {kind:'stop',reason:'Not enough money for the next Safari entry.'};
  if(!o.emulator.inBattle&&['wild-land','fishing'].includes(s.method)){const supply=this.supplies(o);if(supply)return supply;}
  if(!o.emulator.inBattle&&s.method==='fishing'){
   const rod=this.rodPreparation(o);if(rod)return rod;
   // Fishing has no land RNG plan or Sweet Scent: the cartridge rolls each cast
   // (src/field_player_avatar.c Fishing6) and FishingWildEncounter picks the slot.
   s.phase=m.map?.id===s.route.map?'hunting':'traveling';
   if(s.phase==='hunting'&&o.phase!=='stable')return {kind:'wait'};
   return {kind:'policy',objective:{id:'hunt-requested-pokemon',target:{kind:'fishing-zone',map:s.route.map,rodItemId:s.route.rodItemId},dialogue:'advance',choice:'yes',deferOptionalDetours:true}};
  }
  if(!o.emulator.inBattle&&!m.trainer?.party?.some(p=>p.moves?.includes(230))){
   s.phase='preparing-sweet-scent';
   if(/^MAP_SAFARI_ZONE_/.test(m.map?.id??'')){
    if(o.phase!=='stable'||m.safari?.validity!=='valid')return {kind:'wait'};
    const ui=m.ui??{};
    const recommendation=ui.choiceMenu?{kind:'choose-menu-option',targetOption:'yes'}:
     ui.fieldDialog?{kind:'acknowledge-cartridge-prompt'}:
     ui.startMenu?{kind:'choose-start-menu-item',targetItem:'retire',targetIndex:ui.startMenu.order?.indexOf('retire')}:
     ui.party||ui.bag?{kind:'close-menu'}:{kind:'open-start-menu'};
    return {kind:'recommendation',recommendation};
   }
   const stored=m.trainer?.storage?.pokemon?.find(p=>p.moves?.includes(230));
   // The party may contain the same species with a different moveset. Require
   // the observed Sweet Scent carrier itself so storage cannot accept that decoy.
   const target=stored?{kind:'party-roster',map:'MAP_CERULEAN_CITY_POKEMON_CENTER_1F',requiredFingerprints:[encounterFingerprint(stored)]}:
    m.trainer?.party?.length>=6?{kind:'party-roster',map:'MAP_CERULEAN_CITY_POKEMON_CENTER_1F',maximumPartySize:5}:
    {kind:'encounter-zone',map:'MAP_ROUTE24'};
   return {kind:'policy',objective:{id:'prepare-sweet-scent',target,dialogue:'advance',choice:'yes',deferOptionalDetours:true,...(target.kind==='encounter-zone'?{captureSpecies:[43],captureFamily:[43]}:{})}};
  }
  s.phase=m.map?.id===s.route.map?'hunting':'traveling';
  // Arrival and post-battle callbacks expose the map before its fade-in and
  // script locks finish. Planning holds the owner still, so let those native
  // frames complete first instead of freezing a black screen for the search.
  if(s.phase==='hunting'){
   if(o.phase!=='stable')return {kind:'wait'};
   // A restored mGBA state can be stable before its first video repaint. Check
   // only at the planning boundary; alpha alone is not visible game content.
   if(videoFrame&&!videoFrame().rgba.some((value,index)=>index%4!==3&&value!==0))return {kind:'wait'};
   if(supportsFireRedLandRngMethod(this.nativeSpecies))return {kind:'rng'};
   return {kind:'policy',objective:{id:'hunt-requested-pokemon',target:{kind:'encounter-zone',map:s.route.map},safari:false,dialogue:'advance',choice:'yes',deferOptionalDetours:true}};
  }
  return {kind:'policy',objective:{id:'hunt-requested-pokemon',target:{kind:'encounter-zone',map:s.route.map},safari:s.method==='safari-land',dialogue:'advance',choice:'yes',deferOptionalDetours:true}};
 }
}
