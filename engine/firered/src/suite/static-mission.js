import {generationWaitFrames} from '../rng/fire-red-rng.js';
import {moltresApproach} from './moltres-route.js';
import {fieldRecoveryObjective} from './field-recovery.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {validateHuntConfig} from '../player/hunt-config.js';
import {evaluateRngTraits} from '../rng/target-traits.js';
import {assertCaptureCapacity} from './storage-capacity.js';
import {campaignNavigationWatch} from '../player/campaign.js';
import {STATIC_ENCOUNTERS,staticAvailability} from './static-availability.js';

export {STATIC_ENCOUNTERS};
export const STATIC_REQUIRED_BALLS=Object.freeze(['any','poke-ball','great-ball','ultra-ball']);
// The request contract of a legendary hunt, shared with the postgame agenda's
// priority target so an invalid request is refused before the agenda changes.
export function validateStaticRequest(request){
 const encounter=STATIC_ENCOUNTERS.find(e=>e.speciesId===request?.speciesId);
 if(request?.game!=='firered'||!encounter||request.quantity!==1)throw Error('Choose one remaining FireRed legendary encounter.');
 if(request.locationId!=='any'||request.encounterLevel.min>encounter.level||request.encounterLevel.max<encounter.level||request.moves?.length||request.heldItemId!=null||request.finalLevel!=null)throw Error('Use the legendary’s native location and level; final setup is a separate task.');
 if(request.ball.requirement==='required'&&!STATIC_REQUIRED_BALLS.includes(request.ball.id))throw Error('This legendary workflow supports Poké, Great and Ultra Balls.');
 return encounter;
}
const policy=(id,target)=>({kind:'policy',objective:{id,target,dialogue:'advance',choice:'no',deferOptionalDetours:true}});
export class StaticMission{
 constructor({id,request,world,story=null,mechanics={},state=null}){
  const encounter=validateStaticRequest(request);
  const index=(world?.data??world)?.maps?.find(m=>m.id===encounter.map)?.objectEvents?.findIndex(e=>e.script===encounter.script);
  if(!(index>=0))throw Error('The legendary interaction does not match the cartridge.');
  this.request=request;this.mechanics=mechanics;this.world=world;this.story=story;this.nativeSpecies=encounter.speciesId;
  this.state=structuredClone(state??{id,method:'static',route:{...encounter,index,method:'static'},phase:'traveling',encounters:0,resets:0,repeated:0,recent:[],elapsedMs:0,protected:false,caught:0});
  if(this.state.id!==id)throw Error('The legendary checkpoint belongs to another request.');
 }
 storyWatch(){return campaignNavigationWatch(this.state.route.map);}
 initialize(o){
  if(this.state.protected||this.state.anchor)return;
  if(o.playerMemory?.storyState?.flagIds?.[this.state.route.flag]!==false)throw Error('This legendary encounter is already used or its availability is unknown.');
  // Refuse a save the engine knows is missing a story gate; unreadable gates
  // are left to the travel and save checks that follow.
  const missing=staticAvailability(o).find(t=>t.speciesId===this.nativeSpecies)?.missing??[];
  if(missing.length)throw Error(`This legendary needs: ${missing.join(', ')}.`);
  assertCaptureCapacity(o.playerMemory.trainer);
 }
 matches(p){return p?.validity==='valid'&&!p.isEgg&&p.species===this.nativeSpecies&&(this.request.shiny==='required'?p.shiny===true:evaluateRngTraits(p,this.request,this.mechanics).matched);}
 capturePolicy(){return validateHuntConfig({observeOnly:false,onShiny:'capture',onTarget:'capture',targets:[{required:{species:[this.nativeSpecies],...(this.request.shiny==='required'?{shiny:true}:{})}}],limits:{maxIdleFrames:36000,maxCaptureTurns:120,maxEscapeAttempts:9}});}
 captureRequirements(){return {nickname:this.request.nickname,optimizeCapture:true,shinyPriority:true,fightTrappedNonTargets:true,minBalls:0,ballIds:this.request.ball.requirement==='required'&&this.request.ball.id!=='any'?[{'poke-ball':4,'great-ball':3,'ultra-ball':2}[this.request.ball.id]]:[2,3,4]};}
 beforeInteraction(o,d){
  if(this.state.phase!=='traveling'||o.playerMemory.map.id!==this.state.route.map||d.winner?.recommendation?.kind!=='interact-with-object'||d.winner.recommendation.objective!=='hunt-'+this.state.route.name.toLowerCase())return false;
  if(!Number.isInteger(o.playerMemory.gameStats?.savedGame)||!o.sram?.sha256)throw Error('The legendary save baseline is unavailable.');
  this.state.saveBaseline={count:o.playerMemory.gameStats.savedGame,sha256:o.sram.sha256};this.state.phase='saving-anchor';return true;
 }
 generationBoundary(){return this.nativeSpecies===150?'dialog-confirmation-v1':'object-interaction-v1';}
 generationTrigger(o,d){
  if(this.state.phase!=='hunting'||this.state.protected||o.playerMemory.map.id!==this.state.route.map||!d.action?.buttons?.includes('a'))return false;
  // The birds execute setwildbattle BEFORE their cry/text; Mewtwo executes it
  // after waitbuttonpress. Waiting at the birds' dialog cannot change their PID.
  return this.generationBoundary()==='object-interaction-v1'
   ?d.winner?.recommendation?.kind==='interact-with-object'&&!Object.values(o.playerMemory.ui??{}).some(Boolean)
   :Boolean(o.playerMemory.ui?.fieldDialog)&&d.winner?.recommendation?.kind==='acknowledge-cartridge-prompt';
 }
 prepareGenerationReset(){
  const s=this.state,r=s.rng,boundary=this.generationBoundary();
  if(s.protected||!r||boundary!=='object-interaction-v1'||r.boundary===boundary)return false;
  // Called only for an unmatched ordinary encounter. The normal reset uses
  // the pre-interaction save instead of retaining an already-generated bird.
  s.timingRevisions=[...(s.timingRevisions??[]),{from:r.boundary??'dialog-confirmation-v1',to:boundary,attempts:r.attempts,lastResult:r.lastResult??null}];
  s.rng={boundary,phase:'calibrating',delay:null,attempts:r.attempts??0,calibrationStartAttempts:r.attempts??0,attemptSeed:null,target:null};
  return true;
 }
 generationWaitFrames(distance){return generationWaitFrames(distance);}
 acceptSavedCapture(capture){
  if(!capture?.nativeSaveVerified)throw Error('The legendary capture must be saved and verified.');
  const complete=this.matches(capture.pokemon);this.state.caught=complete?1:0;
  if(!complete)Object.assign(this.state,{protected:false,protectedAnchor:null,anchor:null,rng:null,capturePlan:null,phase:'traveling'});
  return {complete,caught:this.state.caught,quantity:1};
 }
 inspect(o){
  const s=this.state,m=o.playerMemory,p=m.encounter?.pokemon;
  if(s.protected)return {kind:'capture'};
  if(o.emulator.inBattle&&m.encounter?.kind==='wild'){
   if(p?.validity!=='valid'||typeof p.shiny!=='boolean')return {kind:'wait'};
   if(p.shiny||this.matches(p)){s.protected=true;s.phase='capturing';return {kind:'protect',pokemon:p};}
   if(p.species===this.nativeSpecies&&m.map.id===s.route.map&&s.phase==='hunting'&&s.anchor){
    const fp=encounterFingerprint(p);if(s.lastFingerprint!==fp){s.encounters++;s.lastFingerprint=fp;if(s.recent.includes(fp))s.repeated++;s.recent=[...s.recent,fp].slice(-1024);}
    return {kind:'reset'};
   }
  }
  if(s.elapsedMs>=this.request.limits.maxMinutes*60000||s.encounters>=this.request.limits.maxEncounters)return {kind:'stop',reason:'Legendary hunt budget reached; the remaining encounter is preserved.'};
  if(s.phase==='saving-anchor'){
   const b=s.saveBaseline,verified=m.saveAttemptStatus===1&&m.gameStats.savedGame===b.count+1&&o.sram.sha256!==b.sha256;
   if(verified&&o.emulator.mode==='overworld'&&!Object.values(m.ui??{}).some(Boolean)){s.phase='hunting';return {kind:'anchor'};}
   return policy('legendary-save-anchor',{kind:'save-game',map:s.route.map,saveVerified:verified});
  }
  if(s.phase==='traveling'&&!o.emulator.inBattle){const recovery=fieldRecoveryObjective(o,this.world,this.mechanics,{state:s.fieldCare??={},story:this.story,maxSpend:this.request.limits.maxSpend});if(recovery)return {kind:'policy',objective:recovery};}
  if(s.phase==='traveling'&&!o.emulator.inBattle){
   const ballId=this.captureRequirements().ballIds[0],count=(m.trainer?.bag?.pokeBalls??[]).filter(i=>i.itemId===ballId).reduce((n,i)=>n+i.quantity,0);
   if(count<30){const price={2:1200,3:600,4:200}[ballId],quantity=99,cost=(quantity-count)*price;
    if(cost>Math.min(this.request.limits.maxSpend,m.trainer?.money??0))return {kind:'stop',reason:'The legendary hunt needs funding for its capture supply.'};
    return policy('legendary-stock-balls',{kind:'purchase-items',map:ballId===2?'MAP_FUCHSIA_CITY_MART':ballId===3?'MAP_SAFFRON_CITY_MART':'MAP_VIRIDIAN_CITY_MART',objectIndex:0,items:[{itemId:ballId,quantity,stockIndex:0,unitPrice:price}]});
   }
  }
  if(this.nativeSpecies===146&&s.phase==='traveling'&&!o.emulator.inBattle){
   const objective=moltresApproach(o,s.ascent??={});if(objective)return {kind:'policy',objective};
  }
  return policy('hunt-'+s.route.name.toLowerCase(),{kind:'object',map:s.route.map,index:s.route.index});
 }
}
