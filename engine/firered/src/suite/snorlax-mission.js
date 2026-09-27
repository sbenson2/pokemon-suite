import {encounterFingerprint} from '../player/encounter-tracker.js';
import {validateHuntConfig} from '../player/hunt-config.js';
import {generationWaitFrames} from '../rng/fire-red-rng.js';
import {hiddenPowerMatches} from '../rng/target-traits.js';

const ROUTES=[{map:'MAP_ROUTE12',index:4,flag:84,locationId:'10:276:21:'},{map:'MAP_ROUTE16',index:9,flag:128,locationId:'10:309:21:'}];
// Static availability reads the same route flags and Poké Flute requirement.
export const SNORLAX_ROUTES=Object.freeze(ROUTES.map(r=>Object.freeze({...r}))),POKE_FLUTE_FLAG=573;
const BALLS={'poke-ball':4,'great-ball':3,'ultra-ball':2};
const prices={2:1200,3:600,4:200};
const shops={4:'MAP_VIRIDIAN_CITY_MART',3:'MAP_SAFFRON_CITY_MART',2:'MAP_FUCHSIA_CITY_MART'};
const qty=(o,id)=>(o.playerMemory?.trainer?.bag?.pokeBalls??[]).filter(b=>b.itemId===id).reduce((n,b)=>n+b.quantity,0);
export const ballCount=o=>[2,3,4].reduce((n,id)=>n+qty(o,id),0);
const objective=(id,target,extra={})=>({id,target,dialogue:'advance',...extra});
export function supportsSnorlax(r){
 let reason=null;
 if(r.game!=='firered'||r.speciesId!==143)reason='This executor currently supports FireRed’s Poké Flute Snorlax encounters.';
 else if(r.quantity!==1)reason='One Snorlax can be caught from each remaining static encounter. Set quantity to 1.';
 else if(!['any',...ROUTES.map(r=>r.locationId)].includes(r.locationId))reason='Choose Route 12 or Route 16 for a Snorlax reset hunt.';
 else if(r.moves.length||r.heldItemId!==null||(r.finalLevel!==null&&r.finalLevel!==30))reason='This hunt saves Snorlax as caught at level 30. Final moves, leveling and held-item preparation need a separate task.';
 else if(!['any',...Object.keys(BALLS)].includes(r.ball.id))reason='Snorlax hunts currently support Poké Balls, Great Balls and Ultra Balls.';
 else if(r.encounterLevel.min>30||r.encounterLevel.max<30)reason='Both FireRed Snorlax encounters are level 30.';
 return {supported:!reason,reason};
}
export class SnorlaxMission {
 constructor({id,request,state=null}){
  const support=supportsSnorlax(request);if(!support.supported)throw new Error(support.reason);
  this.request=request;
  this.state=state?structuredClone(state):{id,phase:'preparing',encounters:0,resets:0,repeated:0,recent:[],elapsedMs:0,route:null,anchor:null,lastFingerprint:null,protected:false};
  if(this.state.id!==id)throw new Error('Hunt checkpoint belongs to another request.');
  this.state.method??='snorlax';
 }
 initialize(o){
  if(this.state.route)return;
  const flags=o.playerMemory?.storyState?.flagIds??{};
  const routes=ROUTES.filter(route=>this.request.locationId==='any'||route.locationId===this.request.locationId);
  const route=routes.find(route=>flags[route.flag]===false);
  if(!route)throw new Error(routes.every(route=>flags[route.flag]===true)?'The requested Snorlax is already gone in the current save.':'Snorlax availability could not be verified in the current save.');
  if(flags[POKE_FLUTE_FLAG]!==true)throw new Error('The current save needs the Poké Flute before this hunt can start.');
  const t=o.playerMemory.trainer;
  if(!Number.isSafeInteger(t?.money)||t.partyValidity!=='valid')throw new Error('The current party and money could not be verified.');
  const budget=Math.min(this.request.limits.maxSpend,t.money),reserve=this.request.limits.minBalls;
  const required=this.request.ball.requirement==='required'?BALLS[this.request.ball.id]:null;
  const purchases=[];let cost=0,total=ballCount(o);
  // Reserve can include other ordinary balls. Buy a bounded capture supply first;
  // fill the reserve cheaply when no exact ball is required.
  const captureId=required??2;
  let captureQuantity=Math.max(0,30-qty(o,captureId));
  if(!required)captureQuantity=Math.min(captureQuantity,Math.max(0,Math.floor((budget-Math.max(0,reserve+30-total)*200)/1000)));
  if(captureQuantity){purchases.push({itemId:captureId,quantity:qty(o,captureId)+captureQuantity,unitPrice:prices[captureId],stockIndex:0});cost+=captureQuantity*prices[captureId];total+=captureQuantity;}
  const fill=Math.max(0,reserve+30-total),fillId=required??4;
  if(fill){const existing=purchases.find(p=>p.itemId===fillId);if(existing)existing.quantity+=fill;else purchases.push({itemId:fillId,quantity:qty(o,fillId)+fill,unitPrice:prices[fillId],stockIndex:0});cost+=fill*prices[fillId];total+=fill;}
  if(cost>budget)throw new Error(`The ball reserve and capture supply need ₽${cost}; the allowed available budget is ₽${budget}.`);
  this.state.route=route;this.state.initialMoney=t.money;
  this.state.preparation={cost,totalBalls:total,purchases:purchases.sort((a,b)=>b.itemId-a.itemId)};
 }
 matches(p){
  const r=this.request;
  if(r.shiny==='required'&&p.validity==='valid'&&!p.isEgg&&p.species===143&&p.shiny===true)return true;
  return p.validity==='valid'&&p.species===143&&!p.isEgg&&typeof p.shiny==='boolean'&&
   (r.shiny!=='required'||p.shiny)&&(!r.natures.length||r.natures.includes(p.nature?.name?.toLowerCase()))&&
   (r.gender==='any'||(Number.isInteger(p.personality)&&(p.personality%256<31?'female':'male')===r.gender))&&
   (r.abilityId===null||([0,1].includes(p.abilityNum)&&[17,47][p.abilityNum]===r.abilityId))&&
   Object.entries(r.minIvs).every(([k,v])=>{const stat=({specialAttack:'spAttack',specialDefense:'spDefense'})[k]??k;return Number.isInteger(p.ivs?.[stat])&&p.ivs[stat]>=v;})&&
   Object.entries(r.maxIvs??{}).every(([k,v])=>{const stat=({specialAttack:'spAttack',specialDefense:'spDefense'})[k]??k;return Number.isInteger(p.ivs?.[stat])&&p.ivs[stat]<=v;})&&
   hiddenPowerMatches(p.ivs,r.hiddenPower);
 }
 generationWaitFrames(distance){return generationWaitFrames(distance);}
 capturePolicy(){
  // Only the capture guard consumes this policy; static movement/reset logic
  // belongs to this mission, never the Route 1 wandering hunt planner.
  return {...validateHuntConfig({observeOnly:false,onShiny:'capture',onTarget:'capture',targets:[{required:{species:[143]}}],limits:{maxIdleFrames:36000,maxCaptureTurns:120}}),area:this.state.route.map};
 }
 captureRequirements(){return {nickname:this.request.nickname,optimizeCapture:true,shinyPriority:this.request.shiny==='required',minBalls:this.request.limits.minBalls,ballIds:this.request.ball.requirement==='required'&&BALLS[this.request.ball.id]?[BALLS[this.request.ball.id]]:[2,3,4]};}
 inspect(o){
  const s=this.state,m=o.playerMemory??{},e=m.encounter,p=e?.pokemon;
  if(o.emulator.inBattle&&e?.kind==='wild'){
   if(e.validity!=='valid'||p?.validity!=='valid'||typeof p.shiny!=='boolean'){
    s.unreadableSince??=s.elapsedMs;
    return s.elapsedMs-s.unreadableSince>10000||s.elapsedMs>=this.request.limits.maxMinutes*60000?{kind:'stop',reason:'Encounter identity could not be verified. The current battle is preserved.'}:{kind:'wait',reason:'Reading encounter identity'};
   }
   s.unreadableSince=null;
   if(p.shiny&&this.request.shiny!=='required'&&!this.matches(p))return {kind:'stop',reason:'A shiny was found that does not match every requirement. Its encounter is preserved for review.',protected:true};
   if((p.shiny&&this.request.shiny==='required')||(this.matches(p)&&m.map?.id===s.route.map)){
    this.count(p);s.protected=true;s.phase='capturing';return {kind:'protect',pokemon:p};
   }
   if(s.protected)return {kind:'stop',reason:'The protected encounter changed; inspect the saved battle before proceeding.',protected:true};
   if(s.anchor&&s.phase==='hunting'&&m.map?.id===s.route.map&&p.species===143){this.count(p);return {kind:'reset'};}
  }
  if(s.protected)return {kind:'capture'};
  if(s.elapsedMs>=this.request.limits.maxMinutes*60000)return {kind:'stop',reason:'Maximum hunt time reached.'};
  if(!o.emulator.inBattle&&s.encounters>=this.request.limits.maxEncounters)return {kind:'stop',reason:'Maximum encounter limit reached.'};
  if(o.phase==='stable'&&m.trainer?.partyValidity==='valid'&&m.trainer.party.length>0&&s.initialMoney-m.trainer.money>this.request.limits.maxSpend)return {kind:'stop',reason:'Maximum spending limit reached.'};
  if(s.phase==='preparing'){
   const purchase=s.preparation.purchases.find(p=>qty(o,p.itemId)<p.quantity);
   // Finish the transaction before advancing to the next location.
   if(purchase||m.ui?.mart){const item=(m.ui?.mart?s.preparation.purchases.find(p=>shops[p.itemId]===m.map?.id):null)??purchase??s.preparation.purchases.at(-1);return {kind:'policy',objective:objective('hunt-stock-balls',{kind:'purchase-items',map:shops[item.itemId],objectIndex:0,items:[item]})};}
   s.phase='traveling';
  }
  if(s.phase==='saving-anchor'){
   const verified=m.saveAttemptStatus===1&&m.gameStats?.savedGame===s.saveBaseline.savedGame+1&&o.sram.sha256!==s.saveBaseline.sha256;
   if(verified&&o.emulator.mode==='overworld'&&!m.ui?.saveDialog&&!m.ui?.startMenu){s.phase='hunting';return {kind:'anchor'};}
   return {kind:'policy',objective:objective('hunt-save-anchor',{kind:'save-game',map:s.route.map,saveVerified:verified})};
  }
  return {kind:'policy',objective:objective('hunt-snorlax',{kind:'object',map:s.route.map,index:s.route.index},{choice:'yes'})};
 }
 count(p){const fp=encounterFingerprint(p);if(fp===this.state.lastFingerprint)return;this.state.lastFingerprint=fp;this.state.encounters++;if(this.state.recent.includes(fp))this.state.repeated++;this.state.recent=[...this.state.recent,fp].slice(-1024);}
 beforeInteraction(o,decision){
  if(this.state.phase!=='traveling'||o.playerMemory.map?.id!==this.state.route.map||decision.winner?.recommendation?.kind!=='interact-with-object')return false;
  if(!Number.isSafeInteger(o.playerMemory.gameStats?.savedGame)||!o.sram?.sha256)throw new Error('Native save baseline unavailable.');
  this.state.saveBaseline={savedGame:o.playerMemory.gameStats.savedGame,sha256:o.sram.sha256};this.state.phase='saving-anchor';return true;
 }
}
