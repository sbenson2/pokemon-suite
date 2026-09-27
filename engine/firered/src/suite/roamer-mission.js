import {canContinueRoamerTracking} from './roamer-flight.js';
import {validateHuntConfig} from '../player/hunt-config.js';
import {createPostgameController} from './postgame.js';
import {assertCaptureCapacity} from './storage-capacity.js';
import {fieldRecoveryObjective} from './field-recovery.js';
import {partyFullyRestored} from '../player/recovery.js';

const CELIO='MAP_ONE_ISLAND_POKEMON_CENTER_1F';
const ROAMERS={243:{name:'Raikou',starter:1,starterName:'Squirtle'},244:{name:'Entei',starter:0,starterName:'Bulbasaur'},245:{name:'Suicune',starter:2,starterName:'Charmander'}};
const free=o=>o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory.ui??{}).some(Boolean);
const policy=(id,target)=>({kind:'policy',objective:{id,target,dialogue:'advance',choice:'yes',deferOptionalDetours:true}});

// The roaming identity is generated once by Celio, not by a grass encounter.
// Every reset is confined to the unreleased identity. A shiny release survives
// pursuit, incidental captures, restarts, and the final native save receipt.
export class RoamerMission {
 constructor({id,request,world,story,mechanics={},state=null}){
  const species=request.speciesId,roamer=ROAMERS[species];
  if(request.game!=='firered'||!roamer||request.quantity!==1||!['any','required'].includes(request.shiny))throw Error('Choose one native FireRed roaming legendary.');
  if(request.locationId!=='any'||request.encounterLevel.min>50||request.encounterLevel.max<50||request.moves?.length||request.heldItemId!=null||request.finalLevel!=null)throw Error(`${roamer.name} roams Kanto at level 50. Final setup is a separate task.`);
  if(request.ball.requirement==='required'&&request.ball.id!=='any')throw Error('Roamer capture currently selects the best available ball for a verified first throw.');
  const index=(world.data??world).maps.find(m=>m.id===CELIO)?.objectEvents?.findIndex(e=>e.script==='OneIsland_PokemonCenter_1F_EventScript_Celio');
  if(!(index>=0))throw Error('Celio’s release interaction is unavailable in this cartridge.');
  this.request=request;this.world=world;this.story=story;this.mechanics=mechanics;this.nativeSpecies=species;this.roamer=roamer;
  this.state=structuredClone(state??{id,method:'roamer',route:{method:'roamer',speciesId:species,name:roamer.name,map:CELIO,index,level:50},phase:'preparing',elapsedMs:0,encounters:0,resets:0,protected:false,caught:0});
  if(this.state.id!==id)throw Error('The roaming checkpoint belongs to another hunt.');
  this.preparer=null;
 }
 initialize(o){
  const m=o.playerMemory,r=m.postgameEvidence?.roamer;
  if(m.storyState?.variableIds?.[0x4031]!==this.roamer.starter)throw Error(`${this.roamer.name} needs a ${this.roamer.starterName}-started FireRed save.`);
  if(m.storyState?.flagIds?.[2092]!==true)throw Error('Roamer preparation needs a completed Pokémon League save.');
  if(!r)throw Error('The current roaming Pokémon could not be read.');
  if(this.state.protected||this.state.release)return;
  if(r.species){
   if(r.species!==this.nativeSpecies||!r.active)throw Error(`This save no longer has an available ${this.roamer.name}.`);
   if(!r.shiny&&this.request.shiny==='required')throw Error(`This save has already generated a non-shiny ${this.roamer.name}. Use a save before giving Celio the Sapphire.`);
   this.state.release={...r};this.state.phase='saving-release';
  }else if(m.storyState?.flagIds?.[2116]!==false)throw Error('The unreleased roaming Pokémon could not be verified.');
  assertCaptureCapacity(m.trainer);
 }
 preparationController(o){
  if(this.state.phase!=='preparing')return null;
  if(o.playerMemory.storyState?.flagIds?.[732]===true&&free(o)&&(!this.preparer||this.preparer.canYield(o))){
   this.state.phase='traveling';this.preparer=null;this.state.preparation=null;return null;
  }
  if(!this.preparer){
   this.preparer=createPostgameController({world:this.world,story:this.story,mechanics:this.mechanics,state:this.state.preparation??null});
   if(!this.state.preparation)this.preparer.prepareAcquisition({kind:'national-dex',requestId:this.state.id});
   this.preparer.resume();
  }
  return this.preparer;
 }
 checkpoint(){if(this.preparer)this.state.preparation=this.preparer.state();}
 storyWatch(){return this.preparer?.storyWatch()??{flags:[2203,...Array.from({length:8},(_,i)=>2080+i)],variables:[]};}
 matches(p){return p?.validity==='valid'&&!p.isEgg&&p.species===this.nativeSpecies&&(this.request.shiny!=='required'||p.shiny===true)&&(!this.state.release||p.personality===this.state.release.personality);}
 capturePolicy(){return validateHuntConfig({observeOnly:false,onShiny:'capture',onTarget:'capture',targets:[{required:{species:[this.nativeSpecies],...(this.request.shiny==='required'?{shiny:true}:{})}}],limits:{maxIdleFrames:36000,maxCaptureTurns:120,maxEscapeAttempts:9}});}
 captureRequirements(){return {roamer:true,nickname:this.request.nickname,optimizeCapture:true,shinyPriority:true,fightTrappedNonTargets:true,minBalls:0,ballIds:[2,3,4]};}
 beforeInteraction(o,d){
  const recommendation=d.winner?.recommendation;
  if(this.state.phase!=='traveling'||o.playerMemory.map.id!==CELIO||recommendation?.kind!=='interact-with-object'||recommendation.objective!==`release-${this.roamer.name.toLowerCase()}`)return false;
  this.startSave(o);this.state.phase='saving-anchor';return true;
 }
 startSave(o){
  if(!Number.isSafeInteger(o.playerMemory.gameStats?.savedGame)||!o.sram?.sha256)throw Error('The roaming hunt native save baseline is unavailable.');
  this.state.saveBaseline={count:o.playerMemory.gameStats.savedGame,sha256:o.sram.sha256};
 }
 generationTrigger(o,d){return this.state.phase==='hunting'&&!this.state.release&&!this.state.protected&&o.playerMemory.map.id===CELIO&&o.playerMemory.postgameEvidence?.celioFinalText===true&&Boolean(o.playerMemory.ui?.fieldDialog)&&d.winner?.recommendation?.kind==='acknowledge-cartridge-prompt'&&d.action?.buttons?.includes('a');}
 generationWaitFrames(distance){return Math.max(1,Math.min(600,Math.floor(distance/16)));}
 acceptSavedCapture(capture){
  if(!capture?.nativeSaveVerified||!capture.savedSramSha256)throw Error('The roaming capture needs its verified native save.');
  const complete=this.matches(capture.pokemon);this.state.caught=Number(complete);
  if(!complete){this.state.protected=false;this.state.protectedAnchor=null;this.state.capturePlan=null;this.state.phase=this.state.release?'tracking':'traveling';}
  return {complete,caught:this.state.caught,quantity:1};
 }
 inspect(o,{captureEvidence=null}={}){
  const s=this.state,m=o.playerMemory,r=m.postgameEvidence?.roamer,p=m.encounter?.pokemon;
  if(canContinueRoamerTracking({mission:s,observation:o,evidence:captureEvidence})){
   // Older checkpoints did not count the protected pursuit encounter.
   if(s.pursuitInBattle!==true){s.encounters++;s.pursuitEncounters=(s.pursuitEncounters??0)+1;}
   s.lastFlight={frame:o.frame,personality:r.personality,outcome:m.battleOutcome};
   Object.assign(s,{protected:false,protectedAnchor:null,capturePlan:null,phase:'tracking',reason:null,pursuitInBattle:false});
   return {kind:'roamer-fled'};
  }
  if(o.emulator.inBattle&&m.encounter?.kind==='wild'&&p?.validity==='valid'&&!s.pursuitInBattle){
   s.pursuitInBattle=true;s.encounters++;s.pursuitEncounters=(s.pursuitEncounters??0)+1;
  }else if(free(o)&&!s.protected)s.pursuitInBattle=false;
  if(s.protected)return {kind:'capture'};
  if(o.emulator.inBattle){
   if(m.encounter?.kind==='wild'&&p?.validity==='valid'&&(p.shiny===true||this.matches(p))){s.protected=true;s.phase='capturing';s.foundSpecies=p.species;return {kind:'protect',pokemon:p};}
   return {kind:'policy'};
  }
  if(s.elapsedMs>=this.request.limits.maxMinutes*60000||s.encounters>=this.request.limits.maxEncounters)return {kind:'stop',reason:'Roaming hunt budget reached. The current save is preserved.'};
  if(s.phase==='preparing'){
   if(m.storyState?.flagIds?.[732]===true&&free(o))s.phase='traveling';
   else return {kind:'wait'};
  }
  if(s.phase==='hunting'&&r?.species){
   if(r.species!==this.nativeSpecies||!r.active)return {kind:'stop',reason:`Celio’s roaming release did not match ${this.roamer.name}.`};
   if(!r.shiny&&this.request.shiny==='required'){if(s.lastPersonality!==r.personality){s.encounters++;s.lastPersonality=r.personality;}return {kind:'reset',pokemon:r};}
   s.release={...r};s.phase='saving-release';s.saveBaseline=null;s.rng&&(s.rng.phase='found');
  }
  if(s.phase==='saving-anchor'||s.phase==='saving-release'){
   if(!s.saveBaseline){if(!free(o))return policy('roamer-finish-release',{kind:'map',map:m.map.id});this.startSave(o);}
   const b=s.saveBaseline,verified=m.saveAttemptStatus===1&&m.gameStats.savedGame===b.count+1&&o.sram.sha256!==b.sha256;
   if(verified&&free(o)){
    if(s.phase==='saving-anchor'){s.phase='hunting';return {kind:'anchor'};}
    s.release={...s.release,nativeSaveVerified:true,savedSramSha256:o.sram.sha256};s.phase='tracking';
   }else return policy('roamer-save',{kind:'save-game',map:m.map.id,saveVerified:verified});
  }
  if(s.phase==='tracking'){
   if(o.phase!=='stable')return {kind:'wait'};
   if(!r?.active||r.species!==this.nativeSpecies||r.personality!==s.release.personality||r.shiny!==s.release.shiny)return {kind:'stop',reason:`The saved ${this.roamer.name} identity changed or is unavailable.`};
   if(!r.location)return {kind:'stop',reason:'The Pokémon’s current roaming location could not be read.'};
   const route=(this.world.data??this.world).maps.find(m=>m.id==='MAP_ROUTE1');
   // Crossing Pallet/Route 1 moves the roamer naturally. Only search grass
   // when it is on this route; chasing its previous map moves it again.
   const together=m.map.id==='MAP_ROUTE1'&&r.location.group===route?.group&&r.location.number===route?.number;
   return {...policy(`track-${this.roamer.name.toLowerCase()}`, together?{kind:'encounter-zone',map:'MAP_ROUTE1'}:{kind:'map',map:m.map.id==='MAP_ROUTE1'?'MAP_PALLET_TOWN':'MAP_ROUTE1'}),intentionalRoamerSearch:true};
  }
  if(s.phase==='traveling'){
   // Inventory and HP update before the native transaction closes. Retain the
   // selected task through menus, map transitions and checkpoints; only hand
   // back to Celio after its full result is visible in the idle field.
   const count=id=>(m.trainer.bag?.pokeBalls??[]).filter(b=>b.itemId===id).reduce((n,b)=>n+b.quantity,0);
   if(s.travelTask){
    const t=s.travelTask.objective.target;
    const complete=t.kind==='purchase-items'?t.items.every(i=>count(i.itemId)>=i.quantity):partyFullyRestored(m,this.mechanics);
    if(!free(o)||!complete)return s.travelTask;
    s.travelTask=null;
   }
   // Celio's one-time generation preparation owns its existing ball reserve.
   // General postgame provisioning runs before dispatch; do not replace this
   // reserved supply trip while approaching the generation anchor.
   const recovery=fieldRecoveryObjective(o,this.world,this.mechanics,{state:s.fieldCare??={},story:this.story,maxSpend:this.request.limits.maxSpend,stockSupplies:false});if(recovery)return {kind:'policy',objective:recovery};
   if(free(o)){
    if(count(2)<10){const quantity=30,cost=(quantity-count(2))*1200;if(cost>Math.min(m.trainer.money,this.request.limits.maxSpend))return {kind:'stop',reason:'Roamer preparation needs enough money for capture supplies.'};return s.travelTask=policy('roamer-stock-balls',{kind:'purchase-items',map:'MAP_FUCHSIA_CITY_MART',objectIndex:0,items:[{itemId:2,quantity,stockIndex:0,unitPrice:1200}]});}
   }
  }
  return policy(`release-${this.roamer.name.toLowerCase()}`, {kind:'object',map:CELIO,index:s.route.index});
 }
}
