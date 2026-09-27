import {generationWaitFrames} from '../rng/fire-red-rng.js';
import {fieldRecoveryObjective} from './field-recovery.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {knownCaptureFreeSlots} from '../player/encounter-safety.js';
import {evaluateRngTraits} from '../rng/target-traits.js';
import {validateHuntConfig} from '../player/hunt-config.js';
import {fireRedPokemonCenter} from './fire-red-link-quest.js';

const EEVEE={method:'gift',speciesId:133,nativeSpecies:133,name:'Eevee',map:'MAP_CELADON_CITY_CONDOMINIUMS_ROOF_ROOM',index:1,flag:611,level:25,locationId:'10:763:18:'};
const FOSSILS=[{speciesId:138,name:'Omanyte',flag:749,collectedFlag:627,fossil:1},{speciesId:140,name:'Kabuto',flag:748,collectedFlag:626,fossil:2},{speciesId:142,name:'Aerodactyl',flag:750,collectedFlag:606,fossil:3}].map(p=>({...p,method:'gift',nativeSpecies:p.speciesId,map:'MAP_CINNABAR_ISLAND_POKEMON_LAB_EXPERIMENT_ROOM',index:1,level:5,locationId:'postgame-'+p.name.toLowerCase()}));
const GIFTS=[EEVEE,...FOSSILS,{method:'gift',speciesId:131,nativeSpecies:131,name:'Lapras',map:'MAP_SILPH_CO_7F',index:1,flag:582,level:25,locationId:'postgame-lapras',partySpace:true},
 ...[{speciesId:106,name:'Hitmonlee',index:5},{speciesId:107,name:'Hitmonchan',index:6}].map(p=>({...p,method:'gift',nativeSpecies:p.speciesId,map:'MAP_SAFFRON_CITY_DOJO',flag:632,level:25,locationId:'postgame-'+p.name.toLowerCase(),partySpace:true,offer:true}))];
const scripts={133:'CeladonCity_Condominiums_RoofRoom_EventScript_EeveeBall',131:'SilphCo_7F_EventScript_LaprasGuy',106:'SaffronCity_Dojo_EventScript_HitmonleeBall',107:'SaffronCity_Dojo_EventScript_HitmonchanBall',...Object.fromEntries(FOSSILS.map(p=>[p.speciesId,'CinnabarIsland_PokemonLab_ExperimentRoom_EventScript_FossilScientist']))};
export const giftRoute=speciesId=>{const route=GIFTS.find(r=>r.speciesId===speciesId);return route?{...route}:null;};
const all=t=>[...(t?.party??[]),...(t?.storage?.pokemon??[])];
const policy=(id,target)=>({kind:'policy',objective:{id,target,dialogue:'advance',choice:'no',deferOptionalDetours:true}});

export class GiftMission{
 constructor({id,request,route=null,state=null,world=null,story=null,mechanics={}}){
  const expected=giftRoute(request.speciesId);route=state?.route??route??expected;
  if(request.game!=='firered'||!expected||request.quantity!==1||
    Object.entries(expected).some(([k,v])=>route[k]!==v))throw Error('Choose a remaining supported FireRed gift.');
  if(!['any',expected.locationId].includes(request.locationId)||request.encounterLevel.min>expected.level||request.encounterLevel.max<expected.level)throw Error(`This gift is received at level ${expected.level}.`);
  if(request.ball.requirement==='required'&&!['any','poke-ball'].includes(request.ball.id))throw Error('This gift comes in a Poké Ball.');
  if(request.moves.length||request.heldItemId!==null||request.finalLevel!==null)throw Error('Gift preparation is separate from the requested final setup.');
  if(world&&(world.data??world).maps.find(m=>m.id===route.map)?.objectEvents?.[route.index]?.script!==scripts[request.speciesId])throw Error('The gift script does not match this cartridge.');
  this.request=request;this.mechanics=mechanics;this.world=world;this.story=story;this.nativeSpecies=request.speciesId;
  this.state=state?structuredClone(state):{id,method:'gift',route:{...route},phase:'traveling',encounters:0,resets:0,repeated:0,recent:[],elapsedMs:0,protected:false,caught:0};
  if(this.state.id!==id)throw Error('Gift checkpoint belongs to another request.');
 }
 initialize(o){
  if(this.state.baseline)return;
  const t=o.playerMemory?.trainer,received=o.playerMemory?.storyState?.flagIds?.[this.state.route.flag];
  if(this.state.route.fossil&&o.playerMemory.storyState.flagIds?.[this.state.route.collectedFlag]!==true)throw Error('Collect this fossil before starting its revival.');
  if(received===true)throw Error('This gift was already received. Another Pokémon requires a breeding or trade route.');
  if(received!==false)throw Error('The remaining gift could not be verified.');
  if(t?.partyValidity!=='valid'||t.storage?.validity!=='valid'||!(knownCaptureFreeSlots(t)>0))throw Error('Gift hunting needs verified free party or PC storage.');
  this.state.baseline=all(t).map(encounterFingerprint);
 }
 capturePolicy(){return validateHuntConfig({observeOnly:false,onShiny:'capture',onTarget:'capture',targets:[{required:{shiny:true}}]});}
 captureRequirements(){return {nickname:this.request.nickname,optimizeCapture:true,shinyPriority:true,minBalls:0,ballIds:[2,3,4]};}
 acceptSavedCapture(capture){if(!capture?.nativeSaveVerified)throw Error('The incidental shiny must be saved and verified.');Object.assign(this.state,{protected:false,protectedAnchor:null,anchor:null,rng:null,capturePlan:null,saveBaseline:null,phase:'traveling'});return {complete:false,caught:0,quantity:1};}
 matches(p){return p?.validity==='valid'&&p.species===this.nativeSpecies&&!p.isEgg&&(this.request.shiny==='required'?p.shiny===true:evaluateRngTraits(p,this.request,this.mechanics).matched);}
 generationTrigger(o,decision){const rec=decision.winner?.recommendation;return this.state.phase==='hunting'&&!this.state.protected&&o.playerMemory.map?.id===this.state.route.map&&(this.state.route.offer?rec?.kind==='choose-menu-option'&&rec.targetOption==='yes':rec?.kind==='interact-with-object')&&decision.action?.buttons?.includes('a');}
 // Unlike a locked Snorlax prompt, the gift room is still running field RNG.
 // Approach conservatively and observe each frame near the selected seed.
 generationWaitFrames(distance){return generationWaitFrames(distance);}
 beforeInteraction(o,decision){
  if(this.state.route.fossil&&(o.playerMemory.storyState?.variableIds?.[0x406A]!==2||o.playerMemory.storyState?.variableIds?.[0x4069]!==this.state.route.fossil))return false;
  if(this.state.phase!=='traveling'||o.playerMemory.map?.id!==this.state.route.map||decision.winner?.recommendation?.kind!=='interact-with-object')return false;
  this.state.saveBaseline={counter:o.playerMemory.gameStats.savedGame,sha256:o.sram.sha256};this.state.phase='saving-anchor';return true;
 }
 inspect(o){
  const s=this.state,m=o.playerMemory??{},t=m.trainer,ui=m.ui??{};
  if(o.emulator.inBattle){
   if(m.encounter?.pokemon?.shiny&&!s.protected){s.protected=true;return {kind:'protect',pokemon:m.encounter.pokemon};}
   if(s.protected&&!s.gift)return {kind:'capture'};
   return policy('gift-travel',{kind:'map',map:this.state.route.map});
  }
  if(s.gift){
   if(t?.partyValidity!=='valid'||t.storage?.validity!=='valid'||o.phase!=='stable')return {kind:'wait'};
   const owned=all(t).filter(p=>encounterFingerprint(p)===s.gift.fingerprint);
   if(owned.length!==1)return {kind:'stop',reason:'The protected gift is missing or duplicated.'};
   if(ui.choiceMenu)return {kind:'recommendation',recommendation:{kind:'choose-menu-option',targetOption:this.request.nickname?'yes':'no'}};
   if(ui.naming?.subject==='pokemon'&&this.request.nickname)return {kind:'recommendation',recommendation:{kind:'enter-naming-screen-text',subject:'pokemon',targetText:this.request.nickname}};
   if(ui.fieldDialog)return {kind:'recommendation',recommendation:{kind:'acknowledge-cartridge-prompt'}};
   if(!s.resultBaseline)s.resultBaseline={counter:m.gameStats.savedGame,sha256:o.sram.sha256};
   const verified=m.saveAttemptStatus===1&&m.gameStats.savedGame===s.resultBaseline.counter+1&&o.sram.sha256!==s.resultBaseline.sha256;
   if(verified&&o.emulator.mode==='overworld'&&!ui.saveDialog&&!ui.startMenu){
    s.caught=1;s.phase='complete';
    return {kind:'gift-saved',capture:{...s.gift,pokemon:owned[0],caught:true,nativeSaveVerified:true,savedSramSha256:o.sram.sha256,savedFrame:o.frame}};
   }
   if(['error','saving-error'].includes(ui.saveDialog?.stage))return {kind:'stop',reason:'The native gift save failed.'};
   return policy('save-gift',{kind:'save-game',map:this.state.route.map,saveVerified:verified});
  }
  if(t?.partyValidity==='valid'&&t.storage?.validity==='valid'&&s.phase==='hunting'){
   const added=all(t).filter(p=>p.validity==='valid'&&!s.baseline.includes(encounterFingerprint(p)));
   const p=added.find(p=>p.species===this.nativeSpecies);
   if(p){
    const fp=encounterFingerprint(p);if(fp!==s.lastFingerprint){s.encounters++;if(s.recent.includes(fp))s.repeated++;s.recent=[...s.recent,fp].slice(-1024);s.lastFingerprint=fp;}
    if(p.shiny||this.matches(p)){
     if(s.rng){const predicted=s.rng.target?.pokemon.personality??null;s.rng.phase='found';s.rng.lastResult={predicted,observed:p.personality,matched:predicted===p.personality};s.rng.traits=evaluateRngTraits(p,this.request,this.mechanics);}
     s.protected=true;s.phase='saving-gift';s.gift={pokemon:structuredClone(p),fingerprint:fp};return {kind:'gift-found',pokemon:p};
    }
    if(s.anchor)return {kind:'reset',pokemon:p};
    return {kind:'stop',reason:'No verified pre-gift anchor is available.'};
   }
  }
  if(s.elapsedMs>=this.request.limits.maxMinutes*60000||s.encounters>=this.request.limits.maxEncounters)return {kind:'stop',reason:'Gift search limit reached.'};
  if(s.phase==='saving-anchor'){
   const b=s.saveBaseline,verified=m.saveAttemptStatus===1&&m.gameStats.savedGame===b.counter+1&&o.sram.sha256!==b.sha256;
   if(verified&&o.emulator.mode==='overworld'&&!ui.saveDialog&&!ui.startMenu){s.phase='hunting';return {kind:'anchor'};}
   return policy('gift-save-anchor',{kind:'save-game',map:this.state.route.map,saveVerified:verified});
  }
  if(s.phase==='traveling'&&!o.emulator.inBattle){const recovery=fieldRecoveryObjective(o,this.world,this.mechanics,{state:s.fieldCare??={},story:this.story,maxSpend:this.request.limits.maxSpend});if(recovery)return {kind:'policy',objective:recovery};}
  if(s.route.fossil){
   const vars=m.storyState?.variableIds??{},stage=vars[0x406A],which=vars[0x4069];
   if(!Number.isInteger(stage)||!Number.isInteger(which))return {kind:'stop',reason:'The fossil revival stage could not be verified.'};
   if(stage>0&&which!==s.route.fossil)return {kind:'stop',reason:'A different fossil is being revived. Finish that fossil first.'};
   if(stage===1)return policy('fossil-walk-out',{kind:'map-arrival',map:'MAP_CINNABAR_ISLAND_POKEMON_LAB_ENTRANCE'});
   if(stage===0){const target=policy('hand-in-fossil',{kind:'object',map:s.route.map,index:s.route.index});target.objective.choice='yes';
    if(ui.choiceMenu&&ui.choiceMenu.maxCursor>1)target.objective.choiceIndex=s.route.fossil===3&&((m.storyState.flagIds[627]&&!m.storyState.flagIds[749])||(m.storyState.flagIds[626]&&!m.storyState.flagIds[748]))?1:0;
    return target;}
  }
  if(s.route.partySpace&&(t?.party?.length>=6||ui.storage))return policy('gift-party-space',{kind:'party-roster',map:fireRedPokemonCenter(m.map.id),minimumPartySize:2,maximumPartySize:5,requiredFingerprints:(t?.party??[]).filter(p=>p.moves?.some(id=>[15,19,57,70,127].includes(id))).slice(0,5).map(encounterFingerprint)});
  const target=policy('hunt-'+s.route.name.toLowerCase()+'-gift',{kind:'object',map:s.route.map,index:s.route.index});
  if(s.route.offer)target.objective.choice='yes';return target;
 }
}
