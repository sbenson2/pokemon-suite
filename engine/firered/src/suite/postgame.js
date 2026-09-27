import {fieldRecoveryObjective} from './field-recovery.js';
import {rejectShoppingRoute,resumeShoppingRoute} from './postgame-shopping.js';
import {createPostgameAcquisition} from './native-acquisition.js';
export {createPostgameAcquisition};
import {inspectNativeSaveContinuation} from './native-cold-boot.js';
import {createCampaignPlanner} from '../player/campaign.js';
import {createPolicyAdvisors} from '../player/advisors.js';
import {createCentralPlayer,mapRecommendation,retainedTransitionAction} from '../player/delegator.js';
import {validateHuntConfig} from '../player/hunt-config.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {ownedCaptureCount} from '../rng/protected-capture-plan.js';
import {FireRedEvolutionTask,selectOwnedDexEvolution,partnerTradeReady} from './fire-red-evolution.js';
import {TradePreparation} from './trade-preparation.js';
import {PlayerTask} from './player-task.js';
import {QmmSupplyTask,QMM_WATCH,QMM_DEFAULT_STOCK,qmmPartyHoldsMail,qmmRenewable} from './qmm-supply.js';
import {PostgameAgenda,postgameFailureContext,POSTGAME_WATCH,resolvePostgameObjective,postgameChecklist,isLeagueChallengeMap,normalizePriorityTarget} from './postgame-agenda.js';
import {storageCapacity} from './storage-capacity.js';
import {observePostgameProgress,observePostgameNavigation,observePostgameBoundary} from './postgame-watchdog.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
import {POSTGAME_PROGRESS_WATCH,nationalDexProgress,postgameProgress} from './postgame-progress.js';
import {finishPostgame} from './postgame-completion.js';
import {nationalDexSources} from './national-dex-agenda.js';
import {recordSaveStates,pendingRecordClaim} from './postgame-records.js';
import {refreshLeagueTraining,validLeagueTrainingOwner,noteLeagueExpShareHold} from './league-exp-share.js';
import {resolveFireRedLinkQuest,resolveFireRedTravel,LINK_QUEST_WATCH,saveFireRedLinkUnlock,saveFireRedQuestMilestone,fireRedPokemonCenter} from './fire-red-link-quest.js';

export function canContinuePostgame({enabled,running,mission,nativeTrade,wireless,postgame,recovery,interruptedRecovery}){
 // The checklist releases a blocked, unprotected hunt by deferring its objective
 // and continuing other work. That hunt keeps its own stop and review; after a
 // later pause (an evolution exchange, a restart) it no longer holds the checklist.
 const released=mission?.status==='blocked'&&mission.protected!==true&&Boolean(mission.postgameObjective)&&postgame?.agenda?.enabled===true&&
  !postgame.agenda.hunts?.[mission.postgameObjective]&&recovery?.status!=='recovering';
 if(!enabled||running||(!postgame?.playerTask&&mission?.status!=='complete'&&!released&&(mission||!postgame?.agenda?.enabled))||wireless?.remotePlayers!==0||postgame?.status==='waiting'||postgame?.playerTask?.phase==='complete')return false;
 if(interruptedRecovery?.huntId!=null&&interruptedRecovery.huntId===mission?.id)return false;
 if(!released&&recovery?.huntId===mission?.id&&['recovering','needs-review'].includes(recovery?.status))return false;
 return !nativeTrade||(nativeTrade.phase==='complete'&&nativeTrade.completion?.nativeSaveVerified===true&&nativeTrade.completion?.handshakeVerified===true);
}

export function canRetryPostgameCapture(capture,o){
 const trainer=o.playerMemory?.trainer;
 // FireRed uses outcome 5 for either side's Teleport (and wild Roar).
 // 6 is a cartridge-confirmed wild flee. Neither is a caught receipt.
 return Boolean(capture?.pokemon?.validity==='valid'&&capture.pokemon.shiny===false&&
  capture.fingerprint===encounterFingerprint(capture.pokemon)&&!capture.caught&&!capture.postCatch&&
  o.phase==='stable'&&o.emulator?.mode==='overworld'&&!o.emulator.inBattle&&[1,5,6].includes(o.playerMemory.battleOutcome)&&
  trainer?.partyValidity==='valid'&&trainer.storage?.validity==='valid'&&
  Array.isArray(trainer.party)&&Array.isArray(trainer.storage.pokemon)&&
  ![...trainer.party,...trainer.storage.pokemon].some(p=>encounterFingerprint(p)===capture.fingerprint));
}

export function canYieldPostgame(state,o){
 const capture=state?.player?.encounterSafety?.capture;
 const milestones=[state?.preparation?.nationalDexSave,state?.preparation,state?.agenda?.finalSave,state?.agenda?.workflows?.togepi?.save,
  state?.agenda?.workflows?.fame?.cutRoster?.save,state?.agenda?.workflows?.fame?.temporaryRoster?.save,...recordSaveStates(state?.agenda?.workflows)];
 return Boolean(!state?.save&&!milestones.some(s=>s?.linkSave&&!s.nativeLinkSave)&&
  !state?.acquisition?.dirty&&!state?.dexEvolution?.dirty&&!state?.evolution?.dirty&&!state?.qmm?.dirty&&
  // Party Mail belongs to an active or enabled Mail supply; it must be taken back first.
  !((state?.qmm||state?.qmmEnabled)&&qmmPartyHoldsMail(o))&&
  o?.phase==='stable'&&o.emulator?.mode==='overworld'&&!o.emulator.inBattle&&
  !Object.entries(o.playerMemory?.ui??{}).some(([key,value])=>value&&['startMenu','saveDialog','choiceMenu','party','bag','storage','fieldDialog','mart','pokemonSummary','moveLearning'].includes(key))&&
  (!capture||capture.nativeSaveVerified));
}

// qmmSupply: {enabled, stockTarget} from the owner's opt-in bot setting.
// leagueTraining: {enabled, resumedAt}, the League Exp. Share training setting.
export function createPostgameController({world,story,mechanics,state=null,clock=Date.now,qmmSupply=null,leagueTraining=null}){
 if(state&&state.schema!=='pokemon-suite/postgame/v1')throw new Error('Invalid postgame checkpoint.');
 // The game-clear flag is checked below. An empty story list prevents the
 // campaign's early roster setup from restarting after Hall of Fame.
 const base=createCampaignPlanner({campaign:{objectives:[]},world,story,mechanics,initialState:state?.planner??null});
 const watch=base.storyWatch();
 const storyWatch={...watch,variables:[...new Set([...watch.variables,...LINK_QUEST_WATCH.variables,...POSTGAME_WATCH.variables,...POSTGAME_PROGRESS_WATCH.variables])],flags:[...new Set([...watch.flags,...LINK_QUEST_WATCH.flags,...POSTGAME_WATCH.flags,...POSTGAME_PROGRESS_WATCH.flags,...QMM_WATCH.flags,84,128,...Array.from({length:8},(_,i)=>2080+i),2092,2112,2203])]};
 const agenda=new PostgameAgenda(state?.agenda);
 // League training: a hold from an earlier engine is timed from this start, and
 // the Bot setting read here is kept for the checklist (a pending resume shows).
 const noteLeagueTraining=()=>{const s=agenda.state.workflows?.leagueExpShare;if(!s)return;
  noteLeagueExpShareHold(s,clock());s.owner=leagueTraining?{enabled:leagueTraining.enabled!==false,resumedAt:leagueTraining.resumedAt??null}:null;};
 noteLeagueTraining();
 const fieldTeamPlan=structuredClone(state?.fieldTeamPlan??agenda.state.continuation?.teamPlan??{permanentFamilies:[],utilityAcquisitions:[]});
 let fieldRolesKnown=Boolean(state?.fieldTeamPlan||agenda.state.continuation?.teamPlan);
 let objective=state?.objective??null,player=null,playerState=state?.player??null;
 let status=state?.status??'running',reason=state?.reason??null,captures=state?.captures??0,misses=state?.misses??0;
 let save=state?.save??null,pendingObjective=state?.pendingObjective??null;
 let handoffRequested=state?.control?.handoffRequested===true,partnerAvailable=false;
 let preparation=state?.preparation??state?.agenda?.preparation??(agenda.state.enabled?{kind:'postgame',phase:'prerequisites'}:null);
 // Opt-in Rare Candy supply (question-mark Mail). A stopped supply that holds
 // nothing yet is retried later; one holding Mail blocks for review.
 const qmmEnabled=qmmSupply?.enabled===true,qmmStock=Number.isInteger(qmmSupply?.stockTarget)?qmmSupply.stockTarget:QMM_DEFAULT_STOCK;
 const qmmLedger=structuredClone(state?.qmmLedger??{receipts:[],unavailable:null});
 const qmmAvailable=()=>qmmEnabled&&!(qmmLedger.unavailable?.retryAt>clock());
 const openQmm=args=>new QmmSupplyTask({...args,world,story,mechanics,planner:base,...(qmmSupply?.giveUpTurnByAttempt?{giveUpTurnByAttempt:qmmSupply.giveUpTurnByAttempt}:{})});
 // Turning the setting off drops a clean supply; a dirty one (a pre-battle
 // save or Mail handed out) still finishes its cleanup and native save.
 let qmm=state?.qmm&&(qmmEnabled||state.qmm.dirty)?openQmm({state:state.qmm}):null,qmmBattleInput=false,qmmCaptureOpened=null;
 const qmmOptions={enabled:qmmEnabled,available:qmmAvailable};
 let playerTask=state?.playerTask?new PlayerTask({state:state.playerTask,world,mechanics,planner:base,qmmSupply:qmmOptions}):null;
 let evolution=state?.evolution?new FireRedEvolutionTask({requestId:state.evolution.requestId,state:state.evolution}):null;
 let acquisition=state?.acquisition?createPostgameAcquisition({...state.acquisition,state:state.acquisition,world,mechanics,planner:base}):null;
 let dexEvolution=state?.dexEvolution?new FireRedEvolutionTask({requestId:state.dexEvolution.requestId,state:state.dexEvolution}):null;
 const watchdog=structuredClone(state?.watchdog??{}),deferredEvolutions=structuredClone(state?.deferredEvolutions??agenda.state.deferredEvolutions??[]);
 const deferredAcquisitions=structuredClone(state?.deferredAcquisitions??agenda.state.deferredAcquisitions??[]);
 let health=structuredClone(state?.health??{});
 const fieldCare=structuredClone(state?.fieldCare??agenda.state.fieldCare??{});
 const releaseCleanAcquisition=()=>{if(acquisition?.state.dirty)throw Error('Finish the reserved acquisition and native save before changing tasks.');acquisition=null;};
 const reservedEvolutionFingerprints=()=>[...deferredEvolutions.map(e=>e.state.currentFingerprint??encounterFingerprint(e.state.originalPokemon)),...(evolution?[evolution.state.currentFingerprint??encounterFingerprint(evolution.state.originalPokemon)]:[])];
 // Link prerequisites depend on the pair. The Emerald companion needs the
 // National Dex and Celio's link; a FireRed partner needs only the Pokédex,
 // plus the National Dex for a species outside #1–151.
 const fireRedPartnerStep=()=>{
  const st=(dexEvolution??evolution)?.state,step=st?.steps?.slice(st.index).find(x=>x.kind==='trade');
  return step?.toGame==='firered'&&step.partner!==undefined?step:null;
 };
 const prerequisiteGoal=o=>{
  const flags=o.playerMemory.storyState?.flagIds??{},step=fireRedPartnerStep();
  if(step)return partnerTradeReady(flags,step)?null:flags[2112]!==true?'national-dex':null;
  return flags[2112]!==true?'national-dex':flags[2116]!==true?'sevii-link':null;
 };
 const preparationObjective=o=>{
  const goal=prerequisiteGoal(o);
  // Remember a rejected prerequisite across controller restarts. Owned saves
  // and explicit player requests keep their transaction until it is finished.
  if(agenda.state.enabled&&!evolution&&!dexEvolution&&!playerTask&&!ownedMilestone()&&(agenda.state.failures?.[goal]?.retryAt>clock()||agenda.state.failures?.[goal]?.requiresStateChange&&agenda.state.failures[goal].context===postgameFailureContext(o)))return null;
  const selected=selectPreparationObjective(o);
  return selected?{...selected,postgamePrerequisite:goal}:null;
 };
 const selectPreparationObjective=o=>{
  // Keep the completed receipt visible without restarting its prerequisites.
  if(!preparation||preparation.phase==='complete')return null;
  const m=o.playerMemory,flags=m.storyState?.flagIds??{};
  if(fireRedPartnerStep()&&partnerTradeReady(flags,fireRedPartnerStep()))return null;
  if(flags[2112]===true){
   if(!preparation.travelReady&&!o.emulator.inBattle&&m.trainer?.partyValidity==='valid'){
    const lead=m.trainer.party.filter(p=>p.validity==='valid'&&p.hp>0&&p.moves?.includes(19)).sort((a,b)=>Number(b.stats?.speed??0)-Number(a.stats?.speed??0))[0];
    if(lead&&(lead.slot!==0||m.ui?.party||m.ui?.startMenu))return {id:'evolution-prepare-travel-lead',target:{kind:'lead-party-member',map:m.map.id,fingerprint:encounterFingerprint(lead)},identityEvolution:true,deferOptionalDetours:true};
    if(o.phase==='stable'&&o.emulator.mode==='overworld'&&!Object.values(m.ui??{}).some(Boolean))preparation.travelReady=true;
   }
   const saved=saveFireRedQuestMilestone(o,preparation.nationalDexSave??={}, {flagId:2112,id:'evolution-save-national-dex',label:'The National Pokédex upgrade'});
   if(saved.kind==='policy')return saved.objective;
   if(saved.kind==='stop')return {id:'evolution-national-dex-save-error',target:{kind:'stop-for-review',reason:saved.reason}};
   if(flags[2116]===true){
    const saved=saveFireRedLinkUnlock(o,preparation);
    if(saved.kind==='policy')return saved.objective;
    if(saved.kind==='stop')return {id:'postgame-link-save-error',target:{kind:'stop-for-review',reason:saved.reason}};
    preparation.phase='complete';return null;
   }
   preparation={...preparation,phase:'sevii-link-quest'};
   const selected=resolveFireRedLinkQuest(world,o,preparation.linkQuest??={},fieldTeamPlan);
   for(const species of preparation.linkQuest.utilitySpecies??[]){
    fieldTeamPlan.utilityAcquisitions??=[];
    if(!fieldTeamPlan.utilityAcquisitions.some(a=>a.family?.includes(species)))fieldTeamPlan.utilityAcquisitions.push({family:[species],helperRole:'field',permanentRoster:false});
   }
   return selected;
  }
  const dex=nationalDexProgress(m.trainer?.pokedex?.ownedSpecies),count=dex.known?dex.caught:null;
  if(!Number.isInteger(count))return null;
  if(count<60){
   // Ordinary owned Pokémon can fill missing Dex entries more quickly than
   // another rare encounter. Never consume a shiny or a request's ancestor.
   if(!dexEvolution){
    const options={trainer:m.trainer,protectedFingerprints:reservedEvolutionFingerprints(),canSupply:itemId=>Boolean(base.selectItemPreparation(o,itemId))};
    const fast=selectOwnedDexEvolution(options),capture=fast?null:base.selectPokedexPreparation(o,60);
    const selected=fast??(!capture?selectOwnedDexEvolution({...options,scope:'kanto'}):null);
    if(selected){
     const {pokemon,rule}=selected,id=`national-dex-${pokemon.personality}-${rule.speciesId}`;
     return {id,target:{kind:'postgame-evolve'},evolution:{requestId:id,sourceId:'owned-national-dex',pokemon,request:{game:'firered',speciesId:rule.speciesId,quantity:1,shiny:'any'},steps:[{kind:'evolve',game:'firered',fromSpecies:rule.fromSpecies,speciesId:rule.speciesId},{kind:'verify',game:'firered',speciesId:rule.speciesId}]}};
    }
    return capture??base.selectPokedexPreparation(o,60,{minimumEncounterShare:0});
   }
   return base.selectPokedexPreparation(o,60);
  }
  const map=flags[2203]===true?'MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB':'MAP_ONE_ISLAND_POKEMON_CENTER_1F';
  const script=flags[2203]===true?'PalletTown_ProfessorOaksLab_EventScript_ProfOak':'OneIsland_PokemonCenter_1F_EventScript_Celio';
  const index=world.data.maps.find(m=>m.id===map)?.objectEvents?.findIndex(e=>e.script===script);
  if(!(index>=0))return null;
  return {id:flags[2203]===true?'evolution-unlock-national-dex':'evolution-visit-one-island',target:{kind:'object',map,index},dialogue:'advance',choice:'yes',deferOptionalDetours:true,identityEvolution:true};
 };
 const requirements={optimizeCapture:true,shinyPriority:true,fightTrappedNonTargets:true,minBalls:0,ballIds:[2,3,4],safari:state?.safari===true};
 const dependencyObjective=o=>{
  const m=o.playerMemory,dex=nationalDexProgress(m.trainer?.pokedex?.ownedSpecies),space=storageCapacity(m.trainer),flags=m.storyState?.flagIds??{};
  const goal=flags[2112]!==true?'national-dex':flags[2116]!==true?'sevii-link':'postgame';
  const dependencies=[...Object.entries(agenda.state.failures??{}).map(([id,value])=>({id,...value})),...deferredEvolutions.map(e=>({id:e.state.requestId,reason:e.reason,retryAt:e.retryAt})),
   ...(fieldCare.deferredShopping?[{id:'stock-postgame-supplies',reason:fieldCare.deferredShopping.reason,retryAt:fieldCare.deferredShopping.retryAt,requiresStateChange:fieldCare.deferredShopping.exhausted}]:[])];
  const retryAt=dependencies.filter(d=>!d.requiresStateChange&&d.retryAt>clock()).sort((a,b)=>a.retryAt-b.retryAt)[0]?.retryAt??null;
  const detail=!dex.known||m.trainer?.partyValidity!=='valid'||!space.known?'Verify the current Pokédex, party and PC before choosing another source.':!space.canStart?'Free PC space while preserving the shiny reserve; owned evolutions remain eligible.':retryAt?'Available routes are cooling down after failed attempts; retry the earliest route automatically.':goal==='national-dex'?`Register ${Math.max(0,60-dex.caught)} more species. No verified local capture, evolution, gift or prize route is currently available.`:goal==='sevii-link'?'Complete Celio’s link prerequisites; the current cartridge route could not be resolved.':'Remaining objectives require an available source, route or compatible partner.';
  return {id:'postgame-dependency-'+goal,goal,label:goal==='national-dex'?'Unlock the National Pokédex':goal==='sevii-link'?'Complete Celio’s Ruby and Sapphire quest':'Complete remaining postgame objectives',target:{kind:'await-postgame-dependency',map:m.map.id,reason:fieldCare.deferredShopping?`${detail} Supply basket retained: ${fieldCare.deferredShopping.reason}`:detail},progress:{current:dex.known?dex.caught:null,required:goal==='national-dex'?60:386},dependencies,retryAt};
 };
 // Keep each owner's logical destination while resolving the current ferry
 // leg at the input boundary, including acquisitions and retained recovery.
 const planner={...base,select:o=>resolveFireRedTravel(base.retainedRecovery(o)??objective,o,world),selectCollection:()=>null,campaignStatus:()=>({activeObjective:objective})};
 const menuOpen=o=>Object.entries(o.playerMemory?.ui??{}).some(([key,value])=>value&&['startMenu','saveDialog','choiceMenu','party','bag','storage','fieldDialog','mart','pokemonSummary','moveLearning'].includes(key));
 const ownedMilestone=()=>[preparation?.nationalDexSave,preparation,agenda.state.finalSave,agenda.state.workflows?.togepi?.save,
  agenda.state.workflows?.fame?.cutRoster?.save,agenda.state.workflows?.fame?.temporaryRoster?.save,...recordSaveStates(agenda.state.workflows)].some(s=>s?.linkSave&&!s.nativeLinkSave);
 const canYield=o=>canYieldPostgame({save,preparation,agenda:agenda.state,acquisition:acquisition?.state,dexEvolution:dexEvolution?.state,evolution:evolution?.state,qmm:qmm?.state,qmmEnabled,player:player?.state()??playerState},o);
 const suspendAcquisition=(o,message)=>{
  const capture=(player?.state()??playerState)?.encounterSafety?.capture;
  if(!acquisition?.state.dirty||save||ownedMilestone()||capture&&!capture.nativeSaveVerified||!acquisition?.suspend?.(message,o))return false;
  if(objective?.id==='fund-capture-supplies')base.rejectIncomePreparation(objective,o,clock());
  delete watchdog.boundary;
  watchdog.suspension??={lastAt:clock(),elapsedMs:0};
  status='recovering';reason='Saving the partial acquisition before suspending it.';objective=null;player=null;playerState=null;
  return true;
 };
 const failureDecision=(o,message)=>{
  const capture=(player?.state()??playerState)?.encounterSafety?.capture;
  if(capture&&!capture.nativeSaveVerified){status='waiting';reason=message;return {kind:'blocked',reason};}
  if(agenda.state.enabled&&isLeagueChallengeMap(o.playerMemory?.map?.id)){
   status='waiting';reason=message;health={...health,status:'blocked',reason};
   return {kind:'blocked',reason};
  }
  if(objective?.id==='stock-postgame-supplies'&&canYield(o)){
   const recovery=rejectShoppingRoute(o,{world,story,planner:base,state:fieldCare,now:clock(),reason:message,exhausted:(watchdog.idleMs??0)>=300000});
   if(recovery){
    player=null;playerState=null;watchdog.navigation={};status='recovering';
    reason=recovery.kind==='alternate'?'Trying another reachable mart for the retained basket.':`Shopping deferred: ${message}`;
    objective=recovery.objective??null;
    if(recovery.kind==='deferred')fieldCare.deferredShopping.budget=structuredClone(watchdog);
    if(recovery.kind==='deferred'&&Number.isSafeInteger(o.playerMemory.gameStats?.savedGame)&&o.sram?.sha256){
     save={count:o.playerMemory.gameStats.savedGame,sha256:o.sram.sha256,map:o.playerMemory.map.id};pendingObjective=null;
     objective={id:'postgame-save',target:{kind:'save-game',map:save.map,saveVerified:false},dialogue:'advance'};
    }
    return {kind:'resample',reason,action:{buttons:[],holdFrames:1,releaseFrames:1}};
   }
  }
  if(objective?.id==='fund-capture-supplies'){
   base.rejectIncomePreparation(objective,o,clock());
   if(base.selectIncomePreparation(o,clock())){
    objective=null;player=null;playerState=null;watchdog.navigation={};watchdog.idleMs=0;watchdog.lastAt=clock();status='recovering';reason='Trying another reachable funding route.';
    return {kind:'resample',reason,action:{buttons:[],holdFrames:1,releaseFrames:1}};
   }
  }
  if(suspendAcquisition(o,message))return {kind:'resample',reason,action:{buttons:[],holdFrames:1,releaseFrames:1}};
  if(agenda.state.enabled&&agenda.state.active&&canYield(o)&&!playerTask){
   agenda.defer(agenda.state.active,message,clock(),o);objective=null;player=null;playerState=null;acquisition=null;watchdog.navigation={};status='recovering';reason=message;
   return {kind:'resample',reason,action:{buttons:[],holdFrames:1,releaseFrames:1}};
  }
  status='waiting';reason=message;health={...health,status:'blocked',reason};
  return {kind:'blocked',reason};
 };
  // A waiting task must not drop an owned slope climb or let the bicycle coast
  // on a cycling-road pull. During a field transition the central player owns
  // the retained input, veto excuse and lease continuation; consult it first so
  // its own last decision stays authoritative, then fall back to the shared
  // transition helper and finally to a neutral resample.
  const waitTransitionDecision=o=>{
   if(o.phase!=='stable'&&player){
    const decision=player.decide(o);
    if(decision?.kind==='resample'&&decision.action)
     return {kind:'resample',reason:decision.reason,action:decision.action};
   }
   const continuation=retainedTransitionAction(o,(player?.state()??playerState)?.lastDecision);
   return continuation?{kind:'resample',reason:continuation.reason,action:continuation.action}:null;
  };
  const openPlayer=o=>{
   const owned=new Set(o.playerMemory?.trainer?.pokedex?.ownedSpecies??[]);
  const collecting=storageCapacity(o.playerMemory?.trainer).canStart&&!playerTask&&!evolution&&(!preparation||preparation.phase==='complete'||owned.size<60);
  const missing=collecting?(mechanics.data??mechanics).species.filter(s=>nationalSpeciesId(s.id)&&!owned.has(s.id)).map(s=>s.id):[];
  // FireRed adds 30 to the escape formula per attempt. Nine attempts cover
  // even the slowest untrapped lead; the guard still protects every shiny.
  // A Mail-supply prerequisite (Spearow or Abra for a cartridge trade) is a capture target too.
  const qmmCapture=qmm?.captureSpecies?.()??null;qmmCaptureOpened=qmmCapture;
  const policy=validateHuntConfig({observeOnly:false,onShiny:'capture',onTarget:'capture',targets:[{required:missing.length?{species:missing}:{shiny:true}},...(qmmCapture?[{required:{species:[qmmCapture]}}]:[])],limits:{maxIdleFrames:36000,maxCaptureTurns:120,maxEscapeAttempts:9}});
  player=createCentralPlayer({advisors:createPolicyAdvisors({world,mechanics,campaignPlanner:planner,teamPlan:fieldTeamPlan}),campaignPlanner:planner,mechanics,huntConfig:policy,captureRequirements:requirements,initialState:playerState});
  playerState=null;
 };
 return {
  storyWatch:()=>storyWatch,
  setPartnerAvailability(available){partnerAvailable=available===true?true:available?.available===true?structuredClone(available):false;},
  // A saved Bot setting pushed to the running owner; a resume applies at the next
  // stable field decision outside the League.
  setLeagueTraining(value){if(!validLeagueTrainingOwner(value))throw Error('Invalid League training setting.');leagueTraining=value&&{enabled:value.enabled,resumedAt:value.resumedAt};noteLeagueTraining();},
  recordHunt(id,record){
   if(typeof id!=='string'||!record?.id||record.postgameObjective!==id)throw Error('Invalid postgame hunt reservation.');
   agenda.state.hunts??={};const previous=agenda.state.hunts[id];
   if(previous&&previous.id!==record.id)throw Error('The postgame objective already owns another hunt.');
   agenda.state.hunts[id]=structuredClone(record);
  },
  completeHunt(id,huntId){if(agenda.state.hunts?.[id]?.id===huntId)delete agenda.state.hunts[id];},
  state:()=>{agenda.state.preparation=preparation;agenda.state.fieldCare=fieldCare;agenda.state.deferredAcquisitions=deferredAcquisitions;agenda.state.deferredEvolutions=deferredEvolutions;return {schema:'pokemon-suite/postgame/v1',status,reason,captures,misses,objective,save,pendingObjective,preparation,watchdog,deferredEvolutions,deferredAcquisitions,control:{handoffRequested},health,fieldCare,fieldTeamPlan:fieldRolesKnown?fieldTeamPlan:null,agenda:agenda.state,acquisition:acquisition?.state??null,playerTask:playerTask?.state??null,evolution:evolution?.state??null,dexEvolution:dexEvolution?.state??null,safari:requirements.safari,planner:base.state(),player:player?.state()??playerState,qmm:qmm?.state??null,qmmLedger,qmmEnabled};},
  // options.priorityTarget (host goal): set, replace, or clear (null) the
  // durable agenda's priority target; omitted keeps the saved one.
  beginAdventure(continuation=null,options={}){const priority=Object.hasOwn(options??{},'priorityTarget')?{value:options.priorityTarget}:null;
   if(priority)normalizePriorityTarget(priority.value,clock());// validate before any change
   releaseCleanAcquisition();agenda.start();if(priority)agenda.setPriorityTarget(priority.value,clock());if(continuation){agenda.state.continuation=structuredClone(continuation);if(continuation.teamPlan){Object.assign(fieldTeamPlan,structuredClone(continuation.teamPlan));fieldRolesKnown=true;}}playerTask=null;evolution=null;dexEvolution=null;acquisition=null;preparation={kind:'postgame',phase:'prerequisites'};objective=null;save=null;pendingObjective=null;player=null;playerState=null;this.resume();},
  rejectHunt(record,message,o){
   const id=record?.postgameObjective;
   if(!id||agenda.state.active!==id||agenda.state.hunts?.[id]?.id!==record.id||!canYield(o))return false;
   agenda.defer(id,message,clock(),o);delete agenda.state.hunts[id];
   objective=null;pendingObjective=null;player=null;playerState=null;handoffRequested=false;
   status='recovering';reason=message;watchdog.navigation={};
   health={status:'recovering',task:id,reason:message,lastProgressAt:watchdog.lastProgressAt??null};
   return true;
  },
  beginAcquisition(args){
   if(acquisition&&acquisition.state.requestId!==args.requestId)throw Error('Finish the reserved acquisition before replacing it.');
   const retained=deferredAcquisitions.findIndex(d=>d.state.kind===args.kind&&d.state.speciesId===args.speciesId&&d.retryAt<=clock());
   if(!acquisition&&retained>=0){const [entry]=deferredAcquisitions.splice(retained,1);const saved={...entry.state};delete saved.suspension;delete saved.reason;acquisition=createPostgameAcquisition({...saved,state:saved,world,mechanics,planner:base});}
   acquisition??=createPostgameAcquisition({...args,world,mechanics,planner:base});objective=null;player=null;playerState=null;this.resume();
  },
  acknowledgeAcquisition(){
   if(!acquisition?.state.receipt?.nativeSaveVerified)throw Error('The native acquisition save is not verified.');
   agenda.state.acquisitions??=[];agenda.state.acquisitions.push(acquisition.state.receipt);acquisition=null;objective=null;player=null;playerState=null;
  },
  beginPlayerTask(request){
   releaseCleanAcquisition();
   if(qmm?.state.dirty)throw Error('Finish the Rare Candy supply and its native save before starting another task.');
   const next=new PlayerTask({request,world,mechanics,planner:base,qmmSupply:qmmOptions});qmm=null;
   playerTask=next;evolution=null;dexEvolution=null;preparation={requestId:request.id,kind:request.kind,phase:'working'};
   player=null;playerState=null;objective=null;save=null;pendingObjective=null;this.resume();
  },
  beginQmmSupply({requestId,stockTarget=qmmStock}={}){
   if(!qmmEnabled)throw Error('Enable the Rare Candy supply (question-mark Mail) in Bot settings first.');
   if(qmm&&qmm.state.phase!=='complete'&&qmm.state.requestId!==requestId)throw Error('Finish the current Rare Candy supply first.');
   if(!qmm||qmm.state.requestId!==requestId)qmm=openQmm({requestId,stockTarget});
   objective=null;player=null;playerState=null;this.resume();
  },
  preserveEvolutionSource(){
   releaseCleanAcquisition();
   evolution=null;dexEvolution=null;preparation=null;objective=null;player=null;playerState=null;save=null;pendingObjective=null;
  },
  beginEvolution(args){
   releaseCleanAcquisition();
   if(evolution&&evolution.state.phase!=='complete'&&evolution.state.requestId!==args.requestId)throw Error('Finish or stop the current evolution task before replacing it.');
   this.resume();
   if(!evolution||evolution.state.requestId!==args.requestId)evolution=new FireRedEvolutionTask(args);
   if(preparation?.requestId!==args.requestId)preparation={requestId:args.requestId,kind:'evolution'};
   status='running';reason=null;
  },
  prepareAcquisition(value){
   if(value?.kind!=='national-dex'||typeof value.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value.requestId))throw new Error('Invalid acquisition preparation.');
   preparation={requestId:value.requestId,kind:value.kind};
  },
  resume(){
   if(status==='waiting'){
    const previous=player?.state()??playerState;
    // Resume replans menu/navigation recovery; encounter identity and native
    // save evidence remain intact and can still block unsafe continuation.
    if(previous)playerState={...previous,transactionRecovery:null,movementRecovery:null};
    player=null;
    // A retained progress stop keeps its task for a reviewed resume or update
    // handoff. Restart the unchanged lease so the resumed task gets a fresh
    // chance instead of replaying the exhausted 120-second boundary.
    if(watchdog.boundary&&(watchdog.boundary.elapsedMs??0)>=120000){
     delete watchdog.boundary;watchdog.idleMs=0;watchdog.lastAt=clock();
     watchdog.seen=[];watchdog.storySeen=[];watchdog.verifiedStoryProgress=false;watchdog.reason=null;watchdog.navigation={};
    }
   }
   status='running';reason=null;handoffRequested=false;
  },
  resumeVerifiedCapture(o,fingerprint){
   const previous=player?.state()??playerState,capture=previous?.encounterSafety?.capture;
   if(o.emulator?.inBattle||previous?.encounterSafety?.blocked!=='capture-battler-survival-unknown'||capture?.fingerprint!==fingerprint||capture.nativeSaveVerified||ownedCaptureCount(o,fingerprint)!==1)throw Error('The qualified postgame catch is not verified in this game.');
   playerState={...previous,encounterSafety:{...previous.encounterSafety,blocked:null}};player=null;this.resume();
  },
  wait(message){status='waiting';reason=message;},
  requestHandoff(){handoffRequested=true;},
  canYield,
  observeExecution:update=>player?.observeExecution(update),
  acknowledgeCapture(){captures++;player=null;playerState=null;objective=null;},
  acknowledgeEvolution(){evolution=null;objective=null;player=null;playerState=null;preparation={...preparation,phase:'complete'};},
  acceptEvolutionRoundTrip(result,o){
   const active=dexEvolution??evolution;if(!active)throw Error('There is no current evolution request.');
   active.acceptRoundTrip(result,o);preparation={requestId:active.state.requestId,kind:dexEvolution?'postgame':'evolution',automatic:Boolean(dexEvolution),phase:'preparing'};objective=null;player=null;playerState=null;this.resume();
  },
  acknowledgeDexEvolution(){dexEvolution=null;objective=null;player=null;playerState=null;if(preparation?.automatic)preparation={kind:'postgame',phase:'complete'};},
  deferPartnerEvolution(message){
   if(!dexEvolution||!preparation?.automatic||preparation.phase!=='waiting-for-transfer')throw Error('No automatic evolution is ready to defer.');
   deferredEvolutions.push({state:structuredClone(dexEvolution.state),retryAt:clock()+300000,reason:message});dexEvolution=null;preparation={kind:'postgame',phase:'complete'};objective=null;player=null;playerState=null;this.resume();
  },
  decide(o){
   try{
   if(agenda.state.enabled&&o.phase==='stable'){
    const signature=JSON.stringify([o.playerMemory?.trainer?.pokedex?.ownedSpecies,[582,611,750,749,748,730].map(id=>o.playerMemory?.storyState?.flagIds?.[id])]);
    if(signature!==agenda.state.collectionSignature){agenda.state.collection=nationalDexSources({o,world,mechanics});agenda.state.collectionSignature=signature;}
   }
   if(!fieldRolesKnown&&o.phase==='stable'&&o.playerMemory?.trainer?.partyValidity==='valid'){
    fieldTeamPlan.permanentFamilies=o.playerMemory.trainer.party.map(p=>[p.species]);fieldRolesKnown=true;
   }
   agenda.observe(o);
   if(handoffRequested&&canYield(o))return {kind:'handoff',reason:'Ready to start the queued hunt.'};
   const prerequisite=prerequisiteGoal(o)&&(objective?.postgamePrerequisite??pendingObjective?.postgamePrerequisite??
    (!agenda.state.active&&preparation&&preparation.phase!=='complete'&&objective?.target?.kind!=='await-postgame-dependency'?prerequisiteGoal(o):null));
   const owner=qmm?.watchKey()??acquisition?.state.requestId??dexEvolution?.state.requestId??evolution?.state.requestId??playerTask?.state.request.id??prerequisite??agenda.state.active??
    (objective&&objective.target?.kind!=='await-postgame-dependency'||save||ownedMilestone()?'postgame-maintenance':null);
   if(acquisition?.state.suspension){
    watchdog.suspension??={lastAt:clock(),elapsedMs:0};
    const w=watchdog.suspension,now=clock();w.elapsedMs+=Math.max(0,Math.min(5000,now-w.lastAt));w.lastAt=now;
    if(w.elapsedMs>=60000){status='waiting';reason='The partial acquisition save did not verify in time; its ownership is retained.';return {kind:'blocked',reason};}
   }
   const purpose=acquisition?.state.kind==='game-corner'||objective?.id==='fund-capture-supplies'?'currency':objective?.taskKind==='recovery'?'maintenance':null;
   let progressTimeout=false;
   if(!watchdog.boundary&&((watchdog.idleMs??0)<300000||fieldCare.deferredShopping&&!save&&owner&&watchdog.owner!==owner)){
    const retainedTime=(watchdog.idleMs??0)+Math.max(0,Math.min(5000,clock()-(watchdog.lastAt??clock())));
    const migrateMaintenance=owner==='postgame-maintenance'&&['national-dex','sevii-link'].includes(watchdog.owner)&&!prerequisite;
    const treatingShopping=Boolean(fieldCare.suspendedShopping||fieldCare.resumedBudget);
    // Only the acquisition that owns the watchdog is credited with its native wait.
    progressTimeout=observePostgameProgress(watchdog,o,owner,clock(),purpose,owner===acquisition?.state.requestId?acquisition.progressEvidence?.(o)??null:null);
    if(migrateMaintenance||treatingShopping&&!watchdog.verifiedStoryProgress){watchdog.idleMs=Math.max(watchdog.idleMs??0,retainedTime);progressTimeout=watchdog.idleMs>=300000;}
    delete fieldCare.resumedBudget;
   }
   if(!acquisition?.state.suspension&&(watchdog.boundary||owner&&(watchdog.idleMs??0)>=300000||progressTimeout)){
    const protectedTransaction=!canYield(o)||dexEvolution?.state.baseline||evolution?.state.baseline;
    if(protectedTransaction){
     // An owner whose bounded native wait ran out says so (the Day Care produced no Egg).
     const cause=watchdog.boundary?watchdog.boundary.cause:owner===acquisition?.state.requestId?acquisition.progressTimeoutCause?.(o):null;
     watchdog.reason='Progress timeout: finish the owned transaction and native save before changing tasks.'+(cause?' '+cause:'');
     if(suspendAcquisition(o,watchdog.reason))return {kind:'resample',reason,action:{buttons:[],holdFrames:1,releaseFrames:1}};
     const boundary=observePostgameBoundary(watchdog.boundary??=cause?{cause}:{},o,owner,watchdog.reason,clock());
     health={...boundary,task:owner,objective:objective?.id,target:objective?.target,lastProgressAt:watchdog.lastProgressAt??null};
     if(boundary.status==='failed'){status='waiting';reason=boundary.reason;return {kind:'blocked',reason};}
     status='recovering';reason=boundary.reason;
    }
    else{
     delete watchdog.boundary;
     watchdog.reason='No progress for five active minutes. Replanning the task from the verified field.';
     if(agenda.state.enabled&&isLeagueChallengeMap(o.playerMemory.map.id))return failureDecision(o,'No progress for five active minutes inside the one-way League challenge. Its current task is retained for review.');
     if(objective?.id==='fund-capture-supplies')return failureDecision(o,watchdog.reason);
     if(objective?.id==='stock-postgame-supplies')return failureDecision(o,watchdog.reason);
     watchdog.retries=(watchdog.retries??0)+1;watchdog.idleMs=0;
     if(dexEvolution){
      deferredEvolutions.push({state:structuredClone(dexEvolution.state),retryAt:clock()+300000,reason:watchdog.reason});
      dexEvolution=null;objective=null;watchdog.reason='The blocked evolution is retained for retry; continue other available Pokédex work.';
     }else if(prerequisite&&agenda.state.enabled&&!evolution&&!playerTask&&!acquisition){
      agenda.defer(prerequisite,watchdog.reason,clock(),o);objective=null;
      watchdog.reason='The blocked prerequisite is retained for retry; continue other available postgame work.';
     }else if(agenda.state.active){agenda.defer(agenda.state.active,watchdog.reason,clock(),o);if(acquisition&&!acquisition.state.dirty)acquisition=null;objective=null;}
     else if(!base.recoverStalledTask(o))return failureDecision(o,'No progress for five active minutes and no verified alternative for the maintenance task.');
     const previous=player?.state()??playerState;
     playerState=previous?{...previous,transactionRecovery:null,movementRecovery:null}:null;player=null;
     return {kind:'resample',reason:watchdog.reason,action:{buttons:[],holdFrames:1,releaseFrames:1}};
    }
   }
   if(o.emulator?.callback2==='CB2_EggHatch_1'){
    const ready=o.playerMemory?.postgameEvidence?.eggHatch?.stage===10;
    return {kind:ready?'act':'resample',reason:ready?'Keep the hatched Pokémon’s species name.':'Wait for the native hatching animation.',action:{buttons:ready?['b']:[],holdFrames:ready?1:8,releaseFrames:ready?7:0}};
   }
   // A retried Mail-supply setup battle leaves the title screen on a different
   // frame per attempt, so the cartridge does not replay the failed battle.
   const qmmTitle=qmm?.titleScreenDelay?.(o);
   if(qmmTitle)return {kind:'resample',reason:qmmTitle.reason,action:{buttons:[],holdFrames:qmmTitle.frames,releaseFrames:0}};
   const continuation=inspectNativeSaveContinuation(o);
   if(continuation){status=continuation.kind==='blocked'?'waiting':'running';reason=continuation.reason;return continuation;}
   if(!dexEvolution&&deferredEvolutions.length&&canYield(o)&&!isLeagueChallengeMap(o.playerMemory.map.id)){
    const index=deferredEvolutions.findIndex(e=>e.retryAt<=clock()&&(partnerAvailable||!e.state.steps?.some(s=>s.kind==='trade')));
    if(index>=0){const [retained]=deferredEvolutions.splice(index,1);dexEvolution=new FireRedEvolutionTask({requestId:retained.state.requestId,state:retained.state});objective=null;player=null;playerState=null;}
   }
   if(!playerTask&&!evolution&&o.playerMemory?.storyState?.flagIds?.[2092]!==true){
    if(o.phase!=='stable'||!o.emulator.inputReady)return {kind:'resample',reason:'Waiting for the current game state.',action:{buttons:[],holdFrames:1,releaseFrames:1}};
    status='waiting';reason='Postgame requires a verified completed League save.';return {kind:'blocked',reason};
   }
   if(o.emulator.mode==='hall-of-fame')return {kind:'act',reason:'Continue after Hall of Fame',action:{buttons:['a'],holdFrames:1,releaseFrames:59}};
   if(agenda.state.enabled&&!playerTask&&!evolution&&!dexEvolution&&!acquisition&&!save&&!qmm&&!agenda.priorityPending(o,clock(),{partnerAvailable})){
    const finished=finishPostgame(o,agenda.state,postgameProgress(o,agenda.state));
    if(finished?.kind==='complete'){status='complete';return {kind:'postgame-complete',receipt:finished.receipt};}
    if(finished?.kind==='stop'){status='waiting';reason=finished.reason;return {kind:'blocked',reason};}
    if(finished?.kind==='policy')objective=finished.objective;
   }
   if(!player)openPlayer(o);
   const safety=player.state().encounterSafety;
   let qmmOwns=false;
   if(qmm&&!safety?.capture){
    const next=qmm.inspect(o);
    preparation={...(preparation??{}),qmm:{requestId:qmm.state.requestId,phase:qmm.state.phase,progress:qmm.state.progress??null,reason:qmm.state.reason??null}};
    if(qmmBattleInput&&!o.emulator.inBattle&&o.emulator.mode!=='battle'){qmmBattleInput=false;player=null;playerState=null;openPlayer(o);}
    if(next.kind==='complete'){
     qmmLedger.receipts.push(next.receipt);qmmLedger.unavailable=null;qmm=null;objective=null;player=null;playerState=null;status='running';reason=null;
     return {kind:'resample',reason:'Rare Candy supply saved natively.',action:{buttons:[],holdFrames:1,releaseFrames:1},qmmReceipt:next.receipt};
    }
    if(next.kind==='stop'){
     if(!qmm.state.dirty&&!qmmPartyHoldsMail(o)&&(playerTask||dexEvolution||evolution)){
      // Nothing is held for the supply yet: remember why, fall back to field candies.
      qmmLedger.unavailable={reason:next.reason,at:clock(),retryAt:clock()+1800000};
      qmm=null;objective=null;player=null;playerState=null;
      return {kind:'resample',reason:`Rare Candy supply unavailable: ${next.reason}`,action:{buttons:[],holdFrames:1,releaseFrames:1}};
     }
     status='waiting';reason=`Rare Candy supply: ${next.reason}`;return {kind:'blocked',reason};
    }
    if(next.kind==='power-cycle'){player=null;playerState=null;objective=null;qmmBattleInput=false;return {kind:'power-cycle',reason:next.reason};}
    if(next.kind==='wait')return waitTransitionDecision(o)??{kind:'resample',reason:'Waiting for the Mail supply observation.',action:{buttons:[],holdFrames:4,releaseFrames:0}};
    if(next.kind==='act'){qmmBattleInput||=Boolean(o.emulator.inBattle||o.emulator.mode==='battle');return {kind:'act',reason:next.reason,action:next.action};}
    if(next.kind==='recommendation')return {kind:'act',reason:next.reason,action:mapRecommendation(next.recommendation,o),winner:{recommendation:next.recommendation}};
    if(next.kind==='policy')objective=next.objective;
    // Reopen the field player when the supply's capture target changes.
    if((qmm.captureSpecies?.()??null)!==qmmCaptureOpened&&!o.emulator.inBattle){player=null;playerState=null;openPlayer(o);}
    qmmOwns=true;
   }
   if(playerTask&&!safety?.capture&&!qmmOwns){
    const next=playerTask.inspect(o);
    if(next.kind==='qmm'){
     qmm=openQmm({requestId:`player-${playerTask.state.request.id}`,stockTarget:next.stockTarget});objective=null;player=null;playerState=null;
     return {kind:'resample',reason:'Starting the Rare Candy supply for this request.',action:{buttons:[],holdFrames:1,releaseFrames:1}};
    }preparation={requestId:playerTask.state.request.id,kind:playerTask.state.request.kind,phase:playerTask.state.phase,
      ...(playerTask.state.progress?{progress:playerTask.state.progress}:{})};
    if(next.kind==='complete'){status='complete';return {kind:'player-task-complete',receipt:next.receipt};}
    if(next.kind==='stop'){status='waiting';reason=next.reason;return {kind:'blocked',reason};}
    if(next.kind==='wait')return waitTransitionDecision(o)??{kind:'resample',action:{buttons:[],holdFrames:8,releaseFrames:0}};
    objective=next.objective;
   }
   if(acquisition&&!safety?.capture&&!save&&!o.emulator.inBattle&&!qmmOwns){
    const next=acquisition.inspect(o,{yieldRequested:Boolean(watchdog.boundary)});
    if(next.kind==='complete')return {kind:'acquisition-saved',receipt:next.receipt};
    if(next.kind==='suspended'){
     if(!next.receipt?.nativeSaveVerified)throw Error('A suspended acquisition needs a native save receipt.');
     deferredAcquisitions.push({state:structuredClone(acquisition.state),retryAt:clock()+300000,reason:next.reason});
     if(agenda.state.active)agenda.defer(agenda.state.active,next.reason,clock(),o);
     acquisition=null;objective=null;player=null;playerState=null;delete watchdog.suspension;watchdog.navigation={};watchdog.idleMs=0;
     status='recovering';reason='Partial acquisition saved; continuing other available work.';
     return {kind:'resample',reason,action:{buttons:[],holdFrames:1,releaseFrames:1}};
    }
    if(next.kind==='stop'){
     if(!acquisition.state.suspension&&suspendAcquisition(o,next.reason))return {kind:'resample',reason,action:{buttons:[],holdFrames:1,releaseFrames:1}};
     if(agenda.state.enabled&&agenda.state.active&&canYield(o)){
      agenda.defer(agenda.state.active,next.reason,clock(),o);acquisition=null;objective=null;player=null;playerState=null;
      return {kind:'resample',reason:next.reason,action:{buttons:[],holdFrames:1,releaseFrames:1}};
     }
     status='waiting';reason=next.reason;return {kind:'blocked',reason};
    }
    if(next.kind==='wait')return waitTransitionDecision(o)??{kind:'resample',action:{buttons:[],holdFrames:8,releaseFrames:0}};
    if(next.kind==='act')return next;
    if(next.kind==='recommendation')return {kind:'act',action:mapRecommendation(next.recommendation,o),winner:{recommendation:next.recommendation}};
    objective=next.objective;
   }
   const activeEvolution=dexEvolution??evolution;
   if(activeEvolution&&!safety?.capture&&!save&&!qmmOwns){
    const transferring=preparation?.requestId===activeEvolution.state.requestId&&preparation?.tradePreparation;
    // A Rare Candy detour is offered only when the planner can reach one now.
    let next=transferring?{kind:'external',reason:preparation.transferReason??activeEvolution.state.reason}:activeEvolution.inspect(o,{canSupply:id=>id===68&&qmmAvailable()||Boolean(base.selectItemPreparation(o,id)),
     // A reserved mail slot makes candies renewable: use one every level.
     renewableCandies:qmmAvailable()&&qmmRenewable(o)});
    preparation={...preparation,...(dexEvolution?{requestId:dexEvolution.state.requestId,automatic:dexEvolution.state.steps.some(s=>s.kind==='trade')}:{}),phase:dexEvolution&&!dexEvolution.state.steps.some(s=>s.kind==='trade')?'national-dex':next.kind==='wait'?preparation?.phase:activeEvolution.state.phase,progress:activeEvolution.state.progress,reason:activeEvolution.state.reason??null,
     // The host prepares only the partner owner named by this route.
     // (undefined for the Emerald companion, so it is never serialized).
     partnerOwner:fireRedPartnerStep()?.partner};
    if(next.kind==='complete'){
     if(!dexEvolution)preparation.phase='complete';return {kind:dexEvolution?'dex-evolution-saved':'evolution-saved',receipt:next.receipt};
    }
    const partnerStep=next.kind==='external'?fireRedPartnerStep():null;
    if(next.kind==='external'&&(transferring||(partnerStep?partnerTradeReady(o.playerMemory.storyState?.flagIds,partnerStep):o.playerMemory.storyState?.flagIds?.[2116]===true))){
     // TradePreparation performs the native Center save before any exchange.
     // Celio's link milestone save belongs only to the Emerald pair.
     const saved=partnerStep||transferring&&o.playerMemory.storyState?.flagIds?.[2116]!==false?{kind:'ready'}:saveFireRedLinkUnlock(o,preparation);
     if(saved.kind==='ready'){
      const center=preparation.tradePreparation?.center??fireRedPokemonCenter(o.playerMemory.map.id),nurseIndex=world.data.maps.find(m=>m.id===center)?.objectEvents?.findIndex(e=>/EventScript_Nurse$/.test(e.script));
      if(!(nurseIndex>=0)){status='waiting';reason='The native evolution transfer nurse could not be verified.';return {kind:'blocked',reason};}
      preparation.transferReason=next.reason;
      const transfer=new TradePreparation({receipt:{requestId:activeEvolution.state.requestId,fingerprint:activeEvolution.state.currentFingerprint,state:'saved-awaiting-partner'},center,nurseIndex,mechanics,state:preparation.tradePreparation??null});
      const ready=transfer.inspect(o);preparation.tradePreparation=transfer.state;preparation.phase='preparing-transfer';
      if(ready.kind==='ready'){status='waiting';reason=next.reason;preparation.phase='waiting-for-transfer';return {kind:'blocked',reason};}
      next=ready;
      if(next.kind==='policy')next.objective.identityEvolution=true;
     }else next=saved;
    }
    if(next.kind==='stop'){status='waiting';reason=next.reason;return {kind:'blocked',reason};}
    if(next.kind==='policy')objective=next.objective;
    else if(next.kind==='supply'&&next.item.nativeId===68&&qmmAvailable()&&!qmm){
     qmm=openQmm({requestId:`evolution-${activeEvolution.state.requestId}`.slice(0,90).replace(/[^a-zA-Z0-9_-]/g,'-')+`-${o.frame}`,stockTarget:qmmStock});
     objective=null;player=null;playerState=null;
     return {kind:'resample',reason:'Starting the Rare Candy supply for this evolution.',action:{buttons:[],holdFrames:1,releaseFrames:1}};
    }
    else if(next.kind==='supply'){
     objective=base.selectItemPreparation(o,next.item.nativeId);
     if(!objective){status='waiting';reason=`No currently reachable supply of ${next.item.name??'the required item'} is verified.`;return {kind:'blocked',reason};}
    }else if(next.kind==='national-dex'||next.kind==='external'){objective=preparationObjective(o);preparation.phase=o.playerMemory.storyState?.flagIds?.[2112]===true?'sevii-link-quest':'national-dex';}
    else if(next.kind==='wait')return waitTransitionDecision(o)??{kind:'resample',reason:'Waiting for the evolution observation.',action:{buttons:[],holdFrames:8,releaseFrames:0}};
   }
   if(!safety?.capture&&!qmmOwns){
    requirements.safari=o.playerMemory.battleTypeFlags===132;
    const leagueSave=agenda.state.enabled&&isLeagueChallengeMap(o.playerMemory.map.id)&&
     objective?.target.kind==='save-game'&&Boolean(agenda.state.workflows?.leagueRecovery?.save);
    if(save){
     const verified=o.playerMemory.saveAttemptStatus===1&&o.playerMemory.gameStats?.savedGame===save.count+1&&o.sram?.sha256!==save.sha256;
     if(verified&&o.emulator.mode==='overworld'&&!menuOpen(o)){
      save=null;objective=pendingObjective;pendingObjective=null;
      if(fieldCare.deferredShopping&&!objective)delete watchdog.boundary;
      const activeTower=agenda.state.active==='trainer-tower'&&
       o.playerMemory.storyState?.variableIds?.[0x4082]===1&&o.playerMemory.map.id.startsWith('MAP_TRAINER_TOWER_');
      if(agenda.state.enabled&&(isLeagueChallengeMap(o.playerMemory.map.id)||activeTower)){
       // A pre-update pending task can retain an outside healer or omit the
       // admitted Tower roster. Finish its save before refreshing the policy.
       objective=null;
       return {kind:'resample',reason:'Continue the challenge after the verified save.',action:{buttons:[],holdFrames:1,releaseFrames:1}};
      }
     }
     else objective={id:'postgame-save',target:{kind:'save-game',map:save.map,saveVerified:verified},dialogue:'advance'};
    }else if(!playerTask&&!activeEvolution&&!acquisition&&o.phase==='stable'&&o.emulator.inputReady&&!o.emulator.inBattle&&
       (o.emulator.mode==='overworld'&&!menuOpen(o)||ownedMilestone()||leagueSave)){
     // A milestone owns its save through the dialog, including its success
     // acknowledgement. Reusing a cached saveVerified=false can save twice.
     const towerActive=agenda.state.active==='trainer-tower'&&o.playerMemory.map.id.startsWith('MAP_TRAINER_TOWER_');
     // League training's cached checklist demand; the Bot setting's resume applies here.
     if(agenda.state.enabled&&o.emulator.mode==='overworld'&&!menuOpen(o)&&!isLeagueChallengeMap(o.playerMemory.map.id))
      refreshLeagueTraining(agenda.state.workflows??={},{o,mechanics,teamPlan:fieldTeamPlan,protectedFingerprints:reservedEvolutionFingerprints(),owner:leagueTraining,now:clock()});
     const eggSave=agenda.state.workflows?.togepi?.save;
     let selected=agenda.state.finalSave?.linkSave&&!agenda.state.finalSave.nativeLinkSave?objective:(eggSave?.linkSave&&!eggSave.nativeLinkSave?resolvePostgameObjective('togepi',o,world,agenda.state.workflows,{mechanics,planner:base}):null);
     const fameSave=agenda.state.workflows?.fame?.temporaryRoster?.save??agenda.state.workflows?.fame?.cutRoster?.save;
     if(!selected&&fameSave?.linkSave&&!fameSave.nativeLinkSave)selected=resolvePostgameObjective('fame-checker',o,world,agenda.state.workflows,{mechanics,planner:base,now:clock()});
     const recordClaim=pendingRecordClaim(agenda.state.workflows);
     if(!selected&&recordClaim)selected=resolvePostgameObjective(recordClaim,o,world,agenda.state.workflows,{mechanics,planner:base,teamPlan:fieldTeamPlan,protectedFingerprints:reservedEvolutionFingerprints(),leagueTraining,now:clock()});
     if(!selected&&agenda.state.enabled&&isLeagueChallengeMap(o.playerMemory.map.id)){
      // The native doors lock this challenge until victory or blackout. Its
      // battle/item recovery owns the room, including an unavailable recovery;
      // ordinary care and agenda deferral cannot send it to an outside center.
      // An open run cycle names the owner: the Hall record first, then League training.
      const open=cycle=>Boolean(cycle&&!cycle.receipt),w=agenda.state.workflows;
      const leagueOwner=open(w?.records?.['hall-sticker']?.cycle)?'hall-sticker':open(w?.training?.cycle)?'league-training':'league-rematch';
      agenda.state.active=leagueOwner;
      selected=resolvePostgameObjective(leagueOwner,o,world,agenda.state.workflows??={},{mechanics,planner:base,teamPlan:fieldTeamPlan,protectedFingerprints:reservedEvolutionFingerprints(),leagueTraining,now:clock()});
      if(selected?.target.kind==='stop-for-review'){
       objective=selected;status='waiting';reason=selected.target.reason;
       return {kind:'blocked',reason};
      }
     }
     // Challenges own their supply budget: the League has its explicit basket,
     // and Tower preparation needs XP. Generic restocking must not turn each
     // earned payout into another cross-region shopping trip. Healing remains.
     // Egg breeding can be selected later in this decision. Keep its daycare
     // recovery reserve before generic care spends the money on a supply trip.
     const nextBudgetOwner=agenda.state.active??(o.playerMemory.storyState?.flagIds?.[2116]===true?
      postgameChecklist(o,agenda.state.workflows,fieldTeamPlan).find(e=>e.status==='pending'&&e.executable&&!e.storageBlocked&&
       !(agenda.state.failures?.[e.id]?.retryAt>clock())&&
       !(agenda.state.failures?.[e.id]?.requiresStateChange&&agenda.state.failures[e.id].context===postgameFailureContext(o)))?.id:null);
     const permitsShopping=!['league-rematch','hall-sticker','league-training','trainer-tower','egg-sticker'].includes(nextBudgetOwner);
     const retainedBudget=fieldCare.deferredShopping?.budget;
     if(!selected&&permitsShopping&&resumeShoppingRoute(o,{world,story,planner:base,state:fieldCare,now:clock()})){
      if(retainedBudget){
       for(const key of Object.keys(watchdog))delete watchdog[key];
       Object.assign(watchdog,structuredClone(retainedBudget),{owner:agenda.state.active??'postgame-maintenance',lastAt:clock()});
       fieldCare.resumedBudget=true;
      }
      objective=fieldCare.active.objective;player=null;playerState=null;
      return {kind:'resample',reason:'Resume the retained supply basket and its existing budget.',action:{buttons:[],holdFrames:1,releaseFrames:1}};
     }
     const stockSupplies=!fieldCare.deferredShopping&&permitsShopping;
     selected??=agenda.state.enabled&&!towerActive&&!ownedMilestone()?fieldRecoveryObjective(o,world,mechanics,{state:fieldCare,story,stockSupplies}):null;
     if(selected?.target.kind==='stop-for-review'&&(fieldCare.suspendedShopping||fieldCare.active?.kind==='shop')){
      objective=selected;status='waiting';reason=selected.target.reason;
      health={...health,status:'blocked',reason};return {kind:'blocked',reason};
     }
     const resolveEntry=next=>{
      const resolved=resolvePostgameObjective(next.id,o,world,agenda.state.workflows??={},{mechanics,planner:base,teamPlan:fieldTeamPlan,protectedFingerprints:reservedEvolutionFingerprints(),partnerAvailable,leagueTraining,now:clock()});
      if(!next.priority||resolved?.target.kind!=='postgame-hunt')return resolved;
      return {...resolved,request:agenda.priorityRequest(resolved.request),priority:{id:next.id,huntId:agenda.state.priorityTarget?.requestId??null}};
     };
     // A user's priority target that needs none of the unfinished prerequisites
     // runs before them; an in-progress milestone save still finishes first.
     if(!selected&&agenda.state.enabled&&agenda.state.priorityTarget&&!ownedMilestone()){
      const next=agenda.select(o,clock(),{partnerAvailable,priorityOnly:true});
      if(next){
       selected=resolveEntry(next);
       if(!selected||selected.target.kind==='stop-for-review'){agenda.defer(next.id,selected?.target.reason??'This objective needs its native workflow.',clock());selected=null;}
      }
     }
     selected??=preparationObjective(o);
     if(!selected&&agenda.state.enabled){
      // Exhaust available candidates in this decision. Deferring an unsupported
      // first entry must not leave the rest of the checklist stranded.
      const budget=postgameChecklist(o,agenda.state.workflows,fieldTeamPlan).length;
      for(let attempt=0;attempt<budget&&!selected;attempt++){
       const next=agenda.select(o,clock(),{partnerAvailable});if(!next)break;
       selected=resolveEntry(next);
       if(!selected||selected.target.kind==='stop-for-review'){
        agenda.defer(next.id,selected?.target.reason??'This objective needs its native workflow.',clock());selected=null;
       }
      }
     }
     selected??=agenda.state.enabled?null:base.select(o)??base.selectCollection(o);
     if(objective&&selected?.id!==objective.id&&!['save-game','await-postgame-dependency'].includes(objective.target?.kind)&&
        !['save-game','stop-for-review'].includes(selected?.target?.kind)&&Number.isSafeInteger(o.playerMemory.gameStats?.savedGame)&&o.sram?.sha256){
      save={count:o.playerMemory.gameStats.savedGame,sha256:o.sram.sha256,map:o.playerMemory.map.id};pendingObjective=selected;
      objective={id:'postgame-save',target:{kind:'save-game',map:save.map,saveVerified:false},dialogue:'advance'};
     }else objective=selected;
    }
   }
   if(!o.emulator.inBattle&&!menuOpen(o)&&!safety?.capture){
    if(!objective&&agenda.state.enabled&&o.phase==='stable')objective=dependencyObjective(o);
    if(objective?.target.kind==='await-postgame-dependency'){
     status='dependency';reason=objective.target.reason;
     return {kind:'resample',reason,action:{buttons:[],holdFrames:60,releaseFrames:0}};
    }
    if(!objective){status='ready';reason='Current task list is exhausted. Other postgame objectives may remain.';return {kind:'resample',reason,action:{buttons:[],holdFrames:60,releaseFrames:0}};}
   }
   if(!agenda.state.enabled&&!safety?.capture&&objective?.target.kind==='stop-for-review'){
    status='waiting';reason=objective.target.reason;return {kind:'blocked',reason};
   }
   if(objective?.target.kind==='postgame-hunt'&&canYield(o))return {kind:'postgame-hunt',request:objective.request,route:objective.route,objectiveId:agenda.state.active,...(objective.priority?{priority:objective.priority}:{})};
   if(objective?.target.kind==='postgame-acquire'&&canYield(o)){
    this.beginAcquisition({...objective.acquisition,requestId:objective.id+'-'+o.frame});
    return {kind:'postgame-acquisition-started',requestId:acquisition.state.requestId};
   }
   if(objective?.target.kind==='postgame-evolve'&&canYield(o)){
    dexEvolution=new FireRedEvolutionTask(objective.evolution);objective=null;player=null;playerState=null;status='running';reason=null;
    return {kind:'postgame-evolution-started',requestId:dexEvolution.state.requestId};
   }
   const effortTask=playerTask?.state.request.kind==='ev-training';
   // Battle preparation owns its XP encounters just as an evolution task does.
   // The guard still claims shinies and missing species before this permission.
   const battleTraining=objective?.importantBattle&&!objective.identityEvolution&&
    Number(objective.battleTeamTargetLevel)>0&&o.playerMemory.trainer.party.some(p=>
     p.validity==='valid'&&!p.isEgg&&p.level>0&&p.level<Number(objective.battleTeamTargetLevel));
   requirements.fightTrappedNonTargets=!effortTask;
   // A supply trip defers incidental ordinary collection, except while the
   // National Dex prerequisite still needs those species. Below sixty caught
   // entries that collection is required work; afterwards it is optional.
   const supplyTrip=Boolean(fieldCare.active?.kind==='shop'||fieldCare.suspendedShopping);
   const dex=nationalDexProgress(o.playerMemory?.trainer?.pokedex?.ownedSpecies);
   const collectionPrerequisite=Boolean(preparation&&preparation.phase!=='complete'&&(!dex.known||dex.caught<60));
   requirements.deferOrdinaryTargets=supplyTrip&&!collectionPrerequisite;
   // The Mail supply's Recycle training (Mr. Mime to level 33) owns its XP
   // encounters the same way, including when a Rare Candy request started it.
   requirements.fightTrainingNonTargets=Boolean(battleTraining||effortTask&&objective?.evTraining?.training||(activeEvolution||qmmOwns&&objective?.qmmSupply) && objective?.identityEvolution && objective?.trainingFingerprint && objective.minimumCoreLevel>0);
   const decision=player.decide(o),capture=player.state().encounterSafety?.capture;
   if(decision.kind==='blocked'&&player.state().encounterSafety?.blocked==='protected-capture-saved'&&capture?.nativeSaveVerified)return {kind:'capture-saved',capture};
   if(decision.kind==='blocked'&&decision.reason==='protected-encounter-lost-or-unverified'&&canRetryPostgameCapture(capture,o)){
    misses++;player=null;playerState=null;objective=null;status='running';reason=null;
    return {kind:'resample',reason:'The ordinary target fainted or escaped. Continue searching for it.',action:{buttons:[],holdFrames:1,releaseFrames:1}};
   }
   if(['blocked','complete'].includes(decision.kind)){
    if(agenda.state.enabled&&isLeagueChallengeMap(o.playerMemory.map.id))return failureDecision(o,decision.reason??'The current League challenge needs review.');
    if(agenda.state.enabled&&agenda.state.active&&canYield(o)&&!safety?.capture){
     agenda.defer(agenda.state.active,decision.reason??'The route needs another attempt.',clock(),o);objective=null;player=null;playerState=null;
     return {kind:'resample',reason:'The objective will retry after other available work.',action:{buttons:[],holdFrames:8,releaseFrames:0}};
    }
    status='waiting';reason=decision.reason;return decision;
   }
   const navigation=observePostgameNavigation(watchdog.navigation??={},o,objective,decision,clock());
   health={...navigation,task:owner,lastProgressAt:watchdog.lastProgressAt??null};
   if(navigation.status==='failed')return failureDecision(o,navigation.reason);
   if(navigation.status==='retry'){
    playerState=player?.state()??playerState;player=null;status='recovering';reason='Rechecking the blocked route against the current game state.';
    return {kind:'resample',reason,action:{buttons:[],holdFrames:1,releaseFrames:1}};
   }
   status=['waiting','temporarily-blocked'].includes(navigation.status)?'recovering':'running';
   reason=navigation.status==='waiting'?navigation.reason:watchdog.reason??null;return decision;
   }finally{
    if(watchdog.boundary&&status!=='waiting'){
     status='recovering';reason=`Finishing the current interaction before saving or deferring: ${watchdog.boundary.reason}`;
     health={...health,status:'draining',reason,remainingMs:Math.max(0,120000-watchdog.boundary.elapsedMs)};
    }
   }
  },
 };
}
