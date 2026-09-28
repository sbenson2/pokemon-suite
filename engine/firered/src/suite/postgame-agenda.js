import {selectOwnedBreeding,FIRE_RED_PRIZES} from './native-acquisition.js';
import {createHash} from 'node:crypto';
export const postgameFailureContext=o=>createHash('sha256').update(JSON.stringify([
 Object.entries(o.playerMemory?.storyState?.flagIds??{}).filter(([id])=>Number(id)>=32).sort(([a],[b])=>Number(a)-Number(b)),o.playerMemory?.trainer?.bag?.keyItems,
 o.playerMemory?.trainer?.pokedex?.ownedSpecies,o.playerMemory?.trainer?.party?.map(p=>[p.personality,p.otId,p.species,p.level,p.moves,p.heldItem,p.stats]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
])).digest('hex');
import {readAcquisitionEvidence} from './acquisition-evidence.js';
import {storageCapacity} from './storage-capacity.js';
import {resolveFireRedTravel,fireRedPokemonCenter} from './fire-red-link-quest.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {createLeagueRecovery} from '../player/league-recovery.js';
import {leagueExpSharePlan,leagueExpShareStep,leagueTraineeReached,observeLeagueExpShareRound,releaseLeagueExpShareHold,recordLeagueExpShareHistory,recordLeagueExpShareLend,leagueExpShareRestore,
 holdLeagueExpShare,leagueTrainingPaused,leagueRematchLevels,leagueSweepLevel} from './league-exp-share.js';
import {qmmLevel} from './qmm-supply.js';
const LEAGUE_ROOMS=Object.freeze(['LORELEIS_ROOM','BRUNOS_ROOM','AGATHAS_ROOM','LANCES_ROOM','CHAMPIONS_ROOM'].map(name=>'MAP_POKEMON_LEAGUE_'+name));
export const isLeagueChallengeMap=map=>LEAGUE_ROOMS.includes(map);
import {giftRoute} from './gift-mission.js';
import {partyFullyRestored} from '../player/recovery.js';
import {STATIC_ENCOUNTERS,validateStaticRequest} from './static-mission.js';
import {staticAvailability,staticTarget} from './static-availability.js';
import {BEFORE_LINK} from './postgame-gates.js';
import {supportsSnorlax} from './snorlax-mission.js';
import {postgameProgress,nationalDexProgress,POSTGAME_PROGRESS_WATCH,missedLoreleiConversation} from './postgame-progress.js';
import {unownForm} from '../evidence/unown-form.js';
import {selectFameChecker,selectUnownForm,fameRosterRestorationComplete} from './postgame-collection-extras.js';
import {postgameSideQuest,readNativeEggHatch,observeTrainerTower} from './postgame-workflows.js';
import {selectNationalDexCapture,postgameCaptureRequest,ALTERING_CAVE_WILD_SET} from './national-dex-agenda.js';
import {selectOwnedDexEvolution,selectOwnedPartnerEvolution,selectTeamPartnerEvolution,availablePartners} from './fire-red-evolution.js';
import {recordComplete,resolvePostgameRecord,observeLeagueReceipt,eggRecordNeedsSpace} from './postgame-records.js';

export const POSTGAME_WATCH={flags:[147,566,582,606,611,626,627,632,675,679,680,700,701,702,703,724,730,731,732,733,738,748,749,750,1208,1209,1210,1211,2092,2112,2116,2121],variables:[0x4001,0x4002,0x4003,0x4004,0x4005,0x4006,0x4007,0x4008,0x400e,0x400f,0x4031,0x4069,0x406A,0x4082,0x4083,
 // VAR_ALTERING_CAVE_WILD_SET: which Altering Cave table the National Dex selector may hunt.
 ALTERING_CAVE_WILD_SET]};
const flag=(o,id)=>o.phase==='stable'?o.playerMemory?.storyState?.flagIds?.[id]:undefined;
POSTGAME_WATCH.flags=[...new Set([...POSTGAME_WATCH.flags,...POSTGAME_PROGRESS_WATCH.flags])];
POSTGAME_WATCH.variables=[...new Set([...POSTGAME_WATCH.variables,...POSTGAME_PROGRESS_WATCH.variables])];
const booleanStatus=value=>value===true?'complete':value===false?'pending':'unknown';
const runnable=new Set(['fossils','lapras','dojo-gift','tanoby','selphy','old-amber','lorelei-visit','memorial-pillar','league-rematch','mewtwo','articuno','zapdos','moltres','togepi','trainer-tower','dunsparce-tunnel','national-collection','roamer']);
runnable.add('unown-forms');runnable.add('fame-checker');
runnable.add('game-corner');runnable.add('eevee');runnable.add('snorlax');runnable.add('oak-completion');
runnable.add('hall-sticker');runnable.add('egg-sticker');
runnable.add('fly-carrier');runnable.add('team-evolution');
runnable.add('league-training');
// These Kanto sources can satisfy the National Dex prerequisite itself.
// Island quests and Mewtwo still require Celio's completed link quest.
const beforeLink=BEFORE_LINK;
// Teammate trade evolutions need Celio's link only for the Emerald partner. A
// ready FireRed partner trades with the Pokédex alone (pair prerequisites are
// re-checked per trade, including the National Dex above #151).
export const postgameEntryNeedsLink=(id,{partnerAvailable=false}={})=>!beforeLink.has(id)&&!(id==='team-evolution'&&availablePartners(partnerAvailable).some(p=>p.title==='firered'));
POSTGAME_WATCH.flags.push(84,128,579,614);

export function readPostgameEvidence(session,runtime,o){
 const eggHatch=readNativeEggHatch(session,runtime,o),acquisition=readAcquisitionEvidence(session,runtime,o);
 // Slots and verified daycare menus own input outside the field observer. Ordinary map
 // transitions still have no complete postgame evidence; do not make an
 // acquisition-only object look like verified roamer/quest evidence.
 if(o?.phase!=='stable'){
  const ownedMenu=acquisition&&(o?.emulator?.callback2==='CB2_RunSlotMachine'||acquisition.daycare?.menuCursor!=null||acquisition.prompt||o?.playerMemory?.ui?.party?.menuType===6);
  return eggHatch?{eggHatch}:ownedMenu?{acquisition}:null;
 }
 const {symbols,structures}=runtime.data??runtime,fields=structures.SaveBlock1.fields;
 const read=(a,n)=>Buffer.from(session.readMemory(a,n));
 const b1=read(symbols.gSaveBlock1Ptr.address,4).readUInt32LE(),b2=read(symbols.gSaveBlock2Ptr.address,4).readUInt32LE();
 if(!b1||!b2||!Number.isInteger(fields.roamer?.offset)||!Number.isInteger(fields.trainerTower?.offset))return null;
 const r=read(b1+fields.roamer.offset,28),tower=read(b1+fields.trainerTower.offset,48);
 const key=read(b2+structures.SaveBlock2.fields.encryptionKey.offset,4).readUInt32LE();
 const personality=r.readUInt32LE(4),ot=o.playerMemory?.trainer?.otId;
 const location=symbols.sRoamerLocation?read(symbols.sRoamerLocation.address,2):null;
 const context=symbols.sGlobalScriptContext?read(symbols.sGlobalScriptContext.address+100,4).readUInt32LE():null;
 const releaseText=symbols.OneIsland_PokemonCenter_1F_Text_ManagedToLinkWithHoennThankYou?.address;
 const optional=(base,field,n)=>Number.isInteger(field?.offset)?read(base+field.offset,n):null;
 const fame=optional(b1,fields.fameChecker,64),jump=optional(b2,structures.SaveBlock2.fields.pokeJump,2),berries=optional(b2,structures.SaveBlock2.fields.berryPick,6),towerId=optional(b1,fields.towerChallengeId,4);
 const trainer=o.playerMemory?.trainer;
 const unownForms=trainer?.partyValidity==='valid'&&trainer.storage?.validity==='valid'&&Array.isArray(trainer.party)&&Array.isArray(trainer.storage.pokemon)?[...new Set([...trainer.party,...trainer.storage.pokemon].filter(p=>!p.isEgg).map(unownForm).filter(n=>n!==null))]:null;
 return {eggHatch,acquisition,celioFinalText:Number.isInteger(releaseText)&&context===releaseText,roamer:{species:r.readUInt16LE(8),hp:r.readUInt16LE(10),level:r[12],active:r[19]===1,personality,ivs:r.readUInt32LE(),
  location:location?{group:location[0],number:location[1]}:null,
  shiny:Number.isInteger(ot)?((personality>>>16)^(personality&65535)^(ot>>>16)^(ot&65535))<8:null},
  trainerTower:Array.from({length:4},(_,i)=>({challenge:i,bestTimeFrames:(tower.readUInt32LE(i*12+4)^key)>>>0,floorsCleared:tower[i*12+8],receivedPrize:!!(tower[i*12+10]&1),hasLost:!!(tower[i*12+10]&8)})),
  trainerTowerChallenge:towerId?.length===4?towerId.readUInt32LE():null,
  fameChecker:fame?.length===64?Array.from({length:16},(_,i)=>({person:i,entries:(fame.readUInt16LE(i*4)>>>2)&63})):null,
  minigames:jump?.length===2&&berries?.length===6?{jumps:jump.readUInt16LE(),berries:berries.readUInt16LE(4)}:null,unownForms};
}

// The worker releases a blocked automatic hunt to the durable agenda. The
// observation is the failure context, so identical failures stop retrying.
export function releaseBlockedHunt(state,objectiveId,reason,o,now=Date.now()){
 const agenda=new PostgameAgenda(state);agenda.defer(objectiveId,reason??'The hunt needs another attempt.',now,o);
 delete agenda.state.hunts?.[objectiveId];return agenda.state;
}

// League training (league-exp-share.js): the controller's cached demand, the
// open round, the lent item and a hold, in that order. Not a progress chapter.
// A hold shows before the first refresh too (a hunt may own the game meanwhile);
// s.owner is the Bot setting the controller last read, for a pending resume.
function leagueTraining(workflows,rematch){
 const s=workflows?.leagueExpShare??{},d=s.demand,plan=d?.plan;
 const paused=()=>[false,{executable:false,paused:true,reason:leagueTrainingPaused(s.disabled,s.owner)}];
 if(!d?.known)return s.disabled&&!s.round?paused():[undefined];
 if(rematch!=='complete')return [false,{executable:false,reason:'Starts after the first stronger League victory.'}];
 if(s.round)return [false,{reason:'Judge the last League round.'}];
 const keeps=plan?.active&&Number(plan.trainee?.personality)===Number(s.lent?.personality)&&Number(plan.trainee?.otId)===Number(s.lent?.otId);
 if(s.lent&&!keeps)return [false,{reason:'Return the lent held item.'}];
 if(d.owner?.enabled===false)return [true,{reason:'Off in Bot settings.'}];
 if(s.disabled)return paused();
 return plan?.active?[false,{reason:d.label}]:[true,{reason:plan?.reason??null}];
}

export function postgameChecklist(o,workflows={},teamPlan=null){
 const m=o.playerMemory??{},owned=new Set(m.trainer?.pokedex?.ownedSpecies??[]),space=storageCapacity(m.trainer);
 const rematch=Number.isInteger(m.gameStats?.leagueEntries)?Boolean(flag(o,2116)&&workflows.league?.receipt?.nativeSaveVerified&&m.gameStats.leagueEntries>=workflows.league.receipt.leagueEntries&&m.gameStats.savedGame>=workflows.league.receipt.savedGame):undefined;
 const entry=(id,label,value,extra={})=>({id,label,status:booleanStatus(value),executable:runnable.has(id),...extra});
 const capture=(id,label,value,speciesId)=>entry(id,label,value,{speciesId,addsPokemon:true,storageBlocked:!space.canStart});
 const roamer=m.postgameEvidence?.roamer,tower=m.postgameEvidence?.trainerTower;
 return [
  entry('league','Enter the Hall of Fame',flag(o,2092)),
  entry('national-dex','Unlock the National Pokédex',flag(o,2112)),
  entry('sevii-link','Complete Celio’s Ruby and Sapphire quest',flag(o,2116)),
  entry('tanoby','Solve Tanoby Key and unlock Unown',flag(o,2121)),
  entry('selphy','Rescue Selphy from Lost Cave',flag(o,147)),
  capture('lapras','Collect the Silph Co. Lapras',flag(o,582),131),
  capture('dojo-gift','Collect the Fighting Dojo Pokémon',flag(o,632),null),
  entry('old-amber','Collect Old Amber',flag(o,606)),
  capture('fossils','Revive the collected fossils',[606,626,627,748,749,750].every(id=>typeof flag(o,id)==='boolean')?flag(o,750)&&(!flag(o,626)||flag(o,748))&&(!flag(o,627)||flag(o,749)):undefined,null),
  capture('mewtwo','Catch Mewtwo',owned.has(150)?true:flag(o,700)===false?false:undefined,150),
  capture('articuno','Catch Articuno',owned.has(144)?true:flag(o,702)===false?false:undefined,144),
  capture('zapdos','Catch Zapdos',owned.has(145)?true:flag(o,703)===false?false:undefined,145),
  capture('moltres','Catch Moltres',owned.has(146)?true:flag(o,701)===false?false:undefined,146),
  capture('togepi','Receive and hatch Togepi',typeof flag(o,730)==='boolean'?flag(o,730)&&owned.has(175)&&(!workflows.togepi?.started||workflows.togepi.receipt?.nativeSaveVerified===true):undefined,175),
  capture('roamer','Catch the roaming legendary',roamer?owned.has(roamer.species)?true:roamer.active?false:undefined:undefined,roamer?.species??null),
  capture('eevee','Collect the Celadon Eevee',flag(o,611),133),
  capture('snorlax','Acquire Snorlax',owned.has(143)?true:flag(o,84)===false||flag(o,128)===false?false:undefined,143),
  capture('game-corner','Collect the Game Corner prize Pokémon',Array.isArray(m.trainer?.pokedex?.ownedSpecies)?FIRE_RED_PRIZES.every(p=>owned.has(p.speciesId)):undefined,null),
  entry('league-rematch','Beat the stronger Elite Four and Champion',rematch),
  entry('trainer-tower','Complete all four Trainer Tower challenges',Array.isArray(tower)&&tower.length===4?tower.every(t=>t.receivedPrize):undefined),
  entry('lorelei-visit','Visit Lorelei after the Rocket Warehouse',flag(o,724),missedLoreleiConversation(m.storyState?.flagIds)?{executable:false,reason:missedLoreleiConversation(m.storyState.flagIds)}:{}),
  entry('memorial-pillar','Complete the Memorial Pillar tribute',flag(o,566)),
  entry('dunsparce-tunnel','Collect the Three Island tunnel reward',flag(o,738)),
  entry('fly-carrier','Keep a Fly user in the party',
   !Array.isArray(m.trainer?.party)?undefined:m.trainer.party.some(p=>p.validity==='valid'&&p.moves?.includes(19))?true:
    m.trainer?.partyValidity==='valid'&&m.trainer?.storage?.validity==='valid'&&
     (m.trainer?.storage?.pokemon??[]).some(p=>p.validity==='valid'&&!p.isEgg&&p.moves?.includes(19))?false:undefined),
  // Teammates with a trade evolution make a partner round trip (the partner's
  // availability is checked when the objective resolves).
  entry('team-evolution','Evolve teammates through partner trades',m.trainer?.partyValidity==='valid'&&m.trainer.storage?.validity==='valid'?
   !selectTeamPartnerEvolution({trainer:m.trainer,partnerAvailable:true,teamPlan}):undefined),
  entry('national-collection','Complete the National Pokédex',Array.isArray(m.trainer?.pokedex?.ownedSpecies)?nationalDexProgress(m.trainer.pokedex.ownedSpecies).complete:undefined),
  capture('unown-forms','Collect all 28 Unown forms',Array.isArray(m.postgameEvidence?.unownForms)?new Set(m.postgameEvidence.unownForms).size===28:undefined,201),
  entry('fame-checker','Complete the Fame Checker',m.postgameEvidence?.fameChecker?.length===16?m.postgameEvidence.fameChecker.every(p=>p.entries===63)&&fameRosterRestorationComplete(workflows):undefined),
  entry('oak-completion','Show Oak the completed Pokédex',flag(o,756),{executable:runnable.has('oak-completion')&&nationalDexProgress(m.trainer?.pokedex?.ownedSpecies).diploma.complete}),
  entry('hall-sticker','Earn the final Hall of Fame sticker',recordComplete('hall-sticker',o,workflows)),
  entry('league-training','Train a Pokémon with the League Exp. Share',...leagueTraining(workflows,booleanStatus(rematch))),
  entry('egg-sticker','Earn the final Egg sticker',recordComplete('egg-sticker',o,workflows),{storageBlocked:eggRecordNeedsSpace(o,workflows)&&!space.canStart}),
  entry('event-islands','Event island encounters',undefined,{executable:false,conditional:true,reason:'Requires the appropriate event tickets and a verified encounter route.'}),
 ].map(e=>({...e,...(!e.executable&&e.status==='pending'&&!e.reason?{reason:e.addsPokemon?'Requires a verified acquisition workflow that preserves shiny opportunities.':'Requires a dedicated workflow.'}:{})}));
}

// The agenda takes ready goals in checklist order, so pending League training
// names the earlier goal it waits for.
function leagueTrainingWait(entries,agenda){
 const i=entries.findIndex(e=>e.id==='league-training'),e=entries[i];
 if(!e||e.status!=='pending'||!e.executable||agenda?.active==='league-training')return entries;
 const first=entries.slice(0,i).find(x=>x.status==='pending'&&x.executable&&!x.storageBlocked);
 return first?entries.map(x=>x===e?{...e,reason:`${e.reason} · waits for ${first.label}`}:x):entries;
}

// A PC release (pc-release.js) owns the game between checklist goals. It is
// shown as the active goal while it runs, and is not a checklist objective.
const PC_RELEASE_ENTRY=Object.freeze({id:'pc-release',label:'Free PC space by releasing Egg-sticker hatchlings',status:'pending',executable:true,conditional:true,
 reason:'Releases only non-shiny, unreserved hatchlings from the Egg sticker’s own breeding, then saves.'});
export function postgamePresentation(o,agenda,previous=null){
 const current=o.phase==='stable',retained=!current&&previous?.evidenceFrame!=null&&previous.evidenceFrame<=o.frame;
 const listed=retained?previous.entries.filter(e=>e.id!=='pc-release'):leagueTrainingWait(postgameChecklist(o,agenda?.workflows,agenda?.continuation?.teamPlan),agenda);
 const entries=agenda?.active==='pc-release'?[...listed,{...PC_RELEASE_ENTRY}]:listed;
 return {...agenda,evidenceCurrent:current,evidenceFrame:current?o.frame:retained?previous.evidenceFrame:null,
  progress:retained?previous.progress:postgameProgress(o,agenda),
  entries:entries.map(e=>{
   const {retry,...entry}=e;
   return {...entry,...(e.status!=='complete'&&agenda?.failures?.[e.id]?{retry:agenda.failures[e.id]}:{})};
  })};
}

// A user goal can name one static target (G1: the engine's static legendaries
// and Snorlax). It outranks the fixed checklist order whenever it is eligible;
// prerequisites it needs (League, National Dex, Celio's link) still come first.
const PRIORITY_REQUEST_SCHEMAS=['pokemon-suite/farming-request/v1','pokemon-suite/farming-request/v2'];
export function normalizePriorityTarget(value,now=Date.now()){
 if(value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['speciesId','shiny','requestId','request'].includes(k)))throw Error('Choose a supported static Pokémon as the priority target.');
 const target=Number.isInteger(value.speciesId)?staticTarget(value.speciesId):null;
 if(!target)throw Error('The priority target must be a supported FireRed static encounter (Mewtwo, Articuno, Zapdos, Moltres or Snorlax).');
 const shiny=value.shiny??value.request?.shiny??'required';
 if(!['required','any'].includes(shiny))throw Error('Choose whether the priority target must be shiny.');
 if(value.requestId!==undefined&&value.requestId!==null&&(typeof value.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value.requestId)))throw Error('Invalid priority request identifier.');
 let request=null;
 if(value.request!==undefined&&value.request!==null){
  const r=value.request;
  if(!r||typeof r!=='object'||!PRIORITY_REQUEST_SCHEMAS.includes(r.schema)||r.game!=='firered'||r.speciesId!==target.speciesId||r.shiny!==shiny)throw Error('The priority request must be a FireRed farming request for the same Pokémon and shiny setting.');
  if(target.method==='static')validateStaticRequest(r);
  else{const support=supportsSnorlax(r);if(!support.supported)throw Error(support.reason);}
  request=structuredClone(r);
 }
 return {schema:'pokemon-suite/postgame-priority/v1',id:target.id,speciesId:target.speciesId,method:target.method,shiny,requestId:value.requestId??null,request,requestedAt:new Date(now).toISOString()};
}

export class PostgameAgenda{
 constructor(state=null){this.state=structuredClone(state??{schema:'pokemon-suite/postgame-agenda/v1',enabled:false,active:null,entries:[],failures:{}});}
 start(){this.state.enabled=true;}
 setPriorityTarget(value,now=Date.now()){
  const next=normalizePriorityTarget(value,now),previous=this.state.priorityTarget;
  if(previous&&(next===null||previous.id!==next.id||previous.requestId!==next.requestId))this.#retirePriority(next===null?'cleared':'replaced',now);
  this.state.priorityTarget=next;
  return next;
 }
 // The hunt request for the priority target: the user's own request, or the
 // checklist's request with the requested shiny setting.
 priorityRequest(request){
  const t=this.state.priorityTarget;if(!t)return request;
  return t.request?structuredClone(t.request):{...request,shiny:t.shiny};
 }
 #retirePriority(outcome,now){
  const t=this.state.priorityTarget;if(!t)return;
  this.state.priorityHistory=[...(this.state.priorityHistory??[]),{...t,outcome,retiredAt:new Date(now).toISOString()}].slice(-20);
  this.state.priorityTarget=null;
 }
 // The priority target when it is eligible now; null otherwise.
 #priority(o,now,partnerAvailable){
  const s=this.state,t=s.priorityTarget;if(!t)return null;
  const a=staticAvailability(o).find(x=>x.id===t.id),entry=s.entries.find(e=>e.id===t.id),failure=s.failures?.[t.id];
  if(a?.available!==true||!entry?.executable||entry.storageBlocked||failure?.retryAt>now||failure?.requiresStateChange&&failure.context===postgameFailureContext(o)||
   !(flag(o,2116)===true||!postgameEntryNeedsLink(t.id,{partnerAvailable})))return null;
  // The checklist marks an owned species complete; the priority follows the
  // encounter itself, so an owned non-shiny Mewtwo does not satisfy a shiny goal.
  return {...entry,status:'pending',priority:true};
 }
 // True while the priority target is eligible; the postgame is not finished.
 priorityPending(o,now=Date.now(),{partnerAvailable=false}={}){
  const s=this.state;if(!s.priorityTarget)return false;
  s.entries=postgameChecklist(o,s.workflows,s.continuation?.teamPlan);
  return Boolean(this.#priority(o,now,partnerAvailable));
 }
 observe(o){
  observeTrainerTower(o,this.state.workflows);
  observeLeagueReceipt(o,this.state.workflows?.league);
  observeLeagueReceipt(o,this.state.workflows?.records?.['hall-sticker']?.cycle);
  observeLeagueTraining(o,this.state.workflows,this.state.active);
 }
 defer(id,reason,now=Date.now(),observation=null){
  const context=observation?postgameFailureContext(observation):null;
  const previous=this.state.failures[id],attempts=previous?.context&&context&&previous.context!==context?1:(previous?.attempts??0)+1;
  this.state.failures[id]={reason,attempts,retryAt:now+Math.min(3600000,300000*2**Math.min(attempts-1,3)),...(context?{context,contextVersion:3}:{}),requiresStateChange:Boolean(context&&attempts>=3)};
  const dex=this.state.workflows?.dex;
  // A capture failure belongs to its encounter map; other maps of the species stay eligible.
  if(id==='national-collection'&&dex?.target){dex.failed??={};dex.failed[dex.target.map?`${dex.target.speciesId}:${dex.target.map}`:dex.target.speciesId]={...this.state.failures[id]};dex.target=null;}
  const fame=this.state.workflows?.fame;
  if(id==='fame-checker'&&fame?.active){fame.failed??={};fame.failed[fame.active]={...this.state.failures[id]};fame.active=null;}
  this.state.active=null;
 }
 select(o,now=Date.now(),{partnerAvailable=false,priorityOnly=false}={}){
  const s=this.state;s.entries=postgameChecklist(o,s.workflows,s.continuation?.teamPlan);
  if(!s.enabled)return null;
  if(flag(o,2092)!==true)return null;
  // Hash-only legacy contexts cannot be decoded. Establish the new baseline
  // once without forgiving consumed attempts or retry deadlines.
  for(const failure of Object.values(s.failures??{}))if(failure.context&&failure.contextVersion!==3){failure.context=postgameFailureContext(o);failure.contextVersion=3;}
  // A used encounter retires the priority target with a receipt.
  if(s.priorityTarget&&staticAvailability(o).find(x=>x.id===s.priorityTarget.id)?.used===true)this.#retirePriority('used',now);
  const eligible=e=>e.status==='pending'&&e.executable&&!e.storageBlocked&&!(s.failures[e.id]?.retryAt>now)&&
   !(s.failures[e.id]?.requiresStateChange&&s.failures[e.id].context===postgameFailureContext(o))&&(flag(o,2116)===true||!postgameEntryNeedsLink(e.id,{partnerAvailable}));
  const pick=()=>this.#priority(o,now,partnerAvailable)??(priorityOnly?null:s.entries.find(eligible));
  let selected=pick();
  // Asked only for an eligible priority target: leave the current owner alone.
  if(priorityOnly&&!selected)return null;
  if(selected){
   const m=o.playerMemory,signature=JSON.stringify([selected.id,m.map?.id,m.position,m.objectEvents?.map(e=>[e.localId,e.current]),m.gameStats?.battles,m.gameStats?.savedGame,
    m.trainer?.party?.map(p=>[p.personality,p.otId,p.species,p.level,p.experience])]);
   if(s.progress?.signature!==signature||o.frame<s.progress.frame)s.progress={signature,frame:o.frame};
   else if(o.frame-s.progress.frame>9000){this.defer(selected.id,'No navigation or objective progress was observed. The route will retry.',now,o);s.progress=null;selected=pick();}
   if(selected){
    const persistent={flags:Object.entries(m.storyState?.flagIds??{}).filter(([id])=>Number(id)>=32),variables:Object.entries(m.storyState?.variableIds??{}).filter(([id])=>Number(id)>=0x4030&&Number(id)<0x8000)};
    const meaningful=JSON.stringify([selected.id,persistent,m.trainer?.pokedex?.ownedSpecies,m.trainer?.party?.map(p=>[p.species,p.level,p.experience,p.friendship,p.isEgg]),m.postgameEvidence?.fameChecker,m.postgameEvidence?.trainerTower?.map(t=>[t.floorsCleared,t.receivedPrize]),m.trainer?.bag]);
    const p=s.semantic;
    if(!p||p.signature!==meaningful)s.semantic={signature:meaningful,lastAt:now,idleMs:0};
    else{p.idleMs+=Math.max(0,Math.min(5000,now-p.lastAt));p.lastAt=now;
     if(p.idleMs>=300000){this.defer(selected.id,'No quest, battle, collection or preparation progress for five active minutes. Try another objective before retrying this route.',now,o);s.semantic=null;selected=pick();}
    }
   }
  }
  s.active=selected?.id??null;
  s.entries=s.entries.map(e=>({...e,...(s.failures[e.id]&&e.status!=='complete'?{retry:s.failures[e.id]}:{})}));
  return selected??null;
 }
}

const TANOBY='MAP_SEVEN_ISLAND_SEVAULT_CANYON_TANOBY_KEY';
const path=(x,y,segments)=>{const points=[{x,y}];for(const [dx,dy,n] of segments)for(let i=0;i<n;i++){x+=dx;y+=dy;points.push({x,y});}return points;};
const BOULDERS=[
 {index:0,path:path(7,6,[[0,-1,4]])},
 {index:6,path:path(6,6,[[1,0,1],[0,-1,2],[-1,0,3]])},
 {index:1,path:path(8,6,[[-1,0,1],[0,-1,2],[1,0,3]])},
 {index:3,path:path(6,10,[[-1,0,1],[0,-1,2]])},
 {index:4,path:path(8,10,[[1,0,1],[0,-1,2]])},
 {index:5,path:path(6,9,[[0,-1,3],[-1,0,1]])},
 {index:2,path:path(8,9,[[0,-1,3],[1,0,1]])},
];

// League training runs: a cycle opens when a round starts (battle-0) and closes
// with its verified Hall of Fame save, counted at once (per trainee while its
// round is open). A run that ended without a new Hall of Fame entry (a whiteout,
// or preempted before Lorelei) is dropped once League training no longer owns
// the agenda, so another owner's League run is never counted as training.
function closeTrainingRun(workflows){
 const training=workflows?.training,receipt=training?.cycle?.receipt,s=workflows?.leagueExpShare;
 if(!receipt)return;
 training.lastRun=receipt;training.runs=(training.runs??0)+1;
 if(s?.round&&s.trainee){const key=`${s.trainee.personality}:${s.trainee.otId}`;(training.byTrainee??={})[key]=(training.byTrainee[key]??0)+1;}
 delete training.cycle;
}
function observeLeagueTraining(o,workflows,active){
 const cycle=workflows?.training?.cycle,m=o.playerMemory??{};
 if(!cycle)return;
 observeLeagueReceipt(o,cycle);closeTrainingRun(workflows);
 if(workflows.training.cycle&&!cycle.hallOfFame&&active!=='league-training'&&!workflows.leagueExpShare?.round&&o.emulator?.mode==='overworld'&&
  !m.map?.id?.startsWith('MAP_POKEMON_LEAGUE_')&&m.gameStats?.leagueEntries===cycle.baseline?.leagueEntries)delete workflows.training.cycle;
}

// League rematch Exp. Share trainee for this decision: {trainee, step, plan}
// (composition: the stop-for-review step when this visit cannot compose it).
// context.leagueTraining is the owner's Bot setting {enabled, resumedAt}; the
// league-training driver (context.requireTrainee) never plans a new filler.
function leagueExpShareState(o,state,context,here,rematchLevels){
 const room=LEAGUE_ROOMS.indexOf(here),inLeague=room>=0,now=context.now??Date.now();
 const s=observeLeagueExpShareRound({o,state,inLeague,room,mechanics:context.mechanics,now});
 // Inside, the round's trainee stays protected until the round is judged,
 // whatever holds meanwhile (owner decision, Sept 26); later rounds keep the full team.
 if(inLeague)return {trainee:s.active&&s.round?s.trainee??null:null};
 releaseLeagueExpShareHold(s,{owner:context.leagueTraining,o,now});
 // Between rounds: record a trainee that reached its target, then re-plan.
 const t=o.playerMemory?.trainer;
 const current=s.trainee?[...(t?.party??[]),...(t?.storage?.pokemon??[])].find(p=>Number(p.personality)===Number(s.trainee.personality)&&Number(p.otId)===Number(s.trainee.otId)):null;
 const level=current&&(Number.isInteger(current.level)?current.level:qmmLevel(current,context.mechanics));
 if(s.trainee&&current&&leagueTraineeReached({...current,level},s.trainee)){
  const reason=Number(level)>=100?'max-level':s.trainee.targetSpecies!=null?'evolved':'target-level';
  recordLeagueExpShareHistory(s,{kind:'completed',trainee:{...s.trainee,level},reason,frame:o.frame??null,at:new Date(now).toISOString()});
  s.completed=[...new Set([...(s.completed??[]),JSON.stringify([s.trainee.personality,s.trainee.otId])])];delete s.trainee;s.active=false;
 }
 if(!rematchLevels.length)return {trainee:null};
 const plan=leagueExpSharePlan({o,mechanics:context.mechanics,teamPlan:context.teamPlan,state:s,owner:context.leagueTraining,
  protectedFingerprints:context.protectedFingerprints??[],sweepLevel:leagueSweepLevel(rematchLevels),includeFiller:context.requireTrainee!==true});
 const center='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';
 const planned=()=>{s.lastPlan={active:plan.active,reason:plan.reason,trainee:plan.trainee??null,frame:o.frame??null};s.lastStep=null;};
 // An unjudged round (unreadable Hall of Fame counter) keeps the full team and
 // its lent item until the verdict; nothing is composed or returned meanwhile.
 if(plan.reason==='round-unjudged'){planned();return {trainee:null,plan};}
 // A trainee that rotated out, or the end of the passive setup, first gets
 // its own held item back (the Exp. Share returns to the Bag).
 const restore=leagueExpShareRestore({o,state:s,plan,mechanics:context.mechanics,center,starterFamily:context.teamPlan?.starterFamily??[]});
 if(restore){s.restoring=restore;if(plan.reason!=='party-or-storage-unknown')planned();return {trainee:restore.shield,step:restore.step,plan};}
 delete s.restoring;
 // Party menus briefly leave a party entry unreadable; keep the last
 // composition then instead of dropping the trainee for a frame.
 if(plan.reason==='party-or-storage-unknown'&&s.lastPlan?.active&&s.lastPlan.trainee)return {trainee:s.lastPlan.trainee,step:s.lastStep??null,plan:s.lastPlan};
 planned();
 if(!plan.active)return {trainee:null,plan};
 const step=leagueExpShareStep({o,plan,mechanics:context.mechanics,center});
 s.lastStep=step??null;
 if(step?.kind==='stop-for-review'){
  // The sticky fallback: this visit and later rounds keep the full team.
  holdLeagueExpShare(s,`composition:${step.reason}`,{o,now});
  return {trainee:null,plan,composition:step};
 }
 recordLeagueExpShareLend(s,{o,plan,step,mechanics:context.mechanics});
 // While lent, the trainee's own item stays reserved in the Bag.
 const own=Number(s.lent?.ownItem)||0;
 return {trainee:own&&Number(s.lent.personality)===Number(plan.trainee.personality)&&Number(s.lent.otId)===Number(plan.trainee.otId)?{...plan.trainee,reservedItemId:own}:plan.trainee,step,plan};
}

export function resolvePostgameObjective(id,o,world,state={},context={}){
 const m=o.playerMemory,here=m.map.id,maps=(world.data??world).maps;
 // Collection/evolution tasks may leave utility members in the party. Restore
 // the established battle six before entering the League; once inside, its
 // current battle and item recovery retain ownership of the one-way rooms.
 const rematchLevels=id==='league-rematch'?leagueRematchLevels(context.mechanics):[];
 // A passive Exp. Share trainee (league-exp-share.js): outside the rooms the
 // plan is recomputed from the party, PC and team plan; inside, the round's
 // recorded trainee rides along until the round is judged, a hold included.
 // It never fights, leads or voluntarily replaces.
 const share=id==='league-rematch'?leagueExpShareState(o,state,context,here,rematchLevels):null;
 const shareTrainee=share?.trainee??null;
 const battleRoster=id==='league-rematch'?{importantBattle:true,battleCategory:'elite-four',
  ...(shareTrainee?{expShareTrainee:{personality:shareTrainee.personality,otId:shareTrainee.otId,species:shareTrainee.species,reason:shareTrainee.reason,
   ...(shareTrainee.reservedItemId?{reservedItemId:shareTrainee.reservedItemId}:{})}}:{}),
  ...(!isLeagueChallengeMap(here)?shareTrainee?{identityEvolution:false}:{minimumBattlePartySize:6,minimumReadyBattleMembers:6,rosterPreparationFor:'postgame-league-rematch',
   ...(rematchLevels.length?{identityEvolution:false,battleTeamTargetLevel:Math.min(100,Math.max(...rematchLevels)+2)}:{})}:{})}:{};
 const objective=(suffix,target,extra={})=>({id:`postgame-${id}-${suffix}`,target,dialogue:'advance',choice:'yes',deferOptionalDetours:true,identityEvolution:true,...battleRoster,...extra});
 const reach=map=>objective('travel',{kind:'map-arrival',map});
 const event=(map,script,kind='object')=>{
  const source=maps.find(m=>m.id===map),events=kind==='background'?source?.backgroundEvents:source?.objectEvents;
  const index=events?.findIndex(e=>e.script===script)??-1;
  if(index<0)return objective('missing-script',{kind:'stop-for-review',reason:`The current cartridge has no verified ${script} interaction.`});
  return objective('interact',{kind,map,index});
 };
 // League training: the League objectives with a composed trainee. The round's
 // native cycle (the Hall record's shape) opens at battle-0 from this baseline.
 if(id==='league-training'){
  const training=state.training??={};closeTrainingRun(state);
  let trainingBaseline=null;
  if(!training.cycle&&!isLeagueChallengeMap(here)){
   const count=m.gameStats?.leagueEntries,saved=m.gameStats?.savedGame;
   if(!Number.isSafeInteger(count)||!Number.isSafeInteger(saved)||!o.sram?.sha256)return objective('baseline',{kind:'stop-for-review',reason:'League training needs a verified native save baseline.'});
   trainingBaseline={leagueEntries:count,savedGame:saved,sha256:o.sram.sha256};
  }
  return resolvePostgameObjective('league-rematch',o,world,state,{...context,requireTrainee:true,trainingBaseline});
 }
 let selected;
 const record=resolvePostgameRecord(id,o,world,state,context,()=>resolvePostgameObjective('league-rematch',o,world,state,context));
 if(record!==undefined)return record?resolveFireRedTravel(record,o,world):null;
 const sideQuest=postgameSideQuest(id,o,world,state,context);
 if(sideQuest!==undefined)return sideQuest?resolveFireRedTravel(sideQuest,o,world):null;
 if(id==='game-corner'){
  const speciesId=[63,35,147,123,137].find(id=>!m.trainer?.pokedex?.ownedSpecies?.includes(id));
  return speciesId?objective('prize-'+speciesId,{kind:'postgame-acquire'},{acquisition:{kind:'game-corner',speciesId}}):null;
 }
 if(id==='unown-forms')return selectUnownForm(o);
 if(id==='fame-checker'){
  const task=selectFameChecker(o,world,state.fame??={},context.now??Date.now());return task?resolveFireRedTravel(task,o,world):null;
 }
 if(id==='snorlax')return {id:'postgame-snorlax',target:{kind:'postgame-hunt'},route:{method:'snorlax'},request:postgameCaptureRequest(143,{shiny:'required'})};
 if(id==='oak-completion')return resolveFireRedTravel(event('MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB','PalletTown_ProfessorOaksLab_EventScript_ProfOak'),o,world);
 if(id==='roamer'){
  const r=m.postgameEvidence?.roamer;
  if(r?.active&&[243,244,245].includes(r.species))return {id:'postgame-roamer',target:{kind:'postgame-hunt'},route:{method:'roamer'},request:postgameCaptureRequest(r.species)};
  return objective('source-required',{kind:'stop-for-review',reason:'This save’s roaming encounter is absent. A compatible trade source is required.'});
 }
 if(id==='team-evolution'){
  const partners=availablePartners(context.partnerAvailable);
  const route=selectTeamPartnerEvolution({trainer:m.trainer,partnerAvailable:context.partnerAvailable,teamPlan:context.teamPlan,protectedFingerprints:context.protectedFingerprints??[]});
  if(route)return objective('partner-'+route.request.speciesId,{kind:'postgame-evolve'},{evolution:route});
  return objective('dependency',{kind:'stop-for-review',reason:partners.length?'No teammate has an available trade evolution.':'Teammate trade evolutions wait for the partner game to be ready for commands.'});
 }
 if(id==='national-collection'){
  const dex=state.dex??={};
  const selected=selectOwnedDexEvolution({trainer:m.trainer,scope:'national',protectedFingerprints:context.protectedFingerprints??[],canSupply:item=>Boolean(context.planner?.selectItemPreparation(o,item))});
  if(selected&&!(dex.failed?.[selected.rule.speciesId]?.retryAt>Date.now())){
   const {pokemon,rule}=selected;dex.target={speciesId:rule.speciesId,method:'evolution'};
   return objective('evolve-'+rule.speciesId,{kind:'postgame-evolve'},{evolution:{requestId:`dex-${pokemon.otId}-${pokemon.personality}-${rule.speciesId}`,sourceId:'owned-national-dex',pokemon,
    request:postgameCaptureRequest(rule.speciesId),steps:[{kind:'evolve',game:'firered',fromSpecies:rule.fromSpecies,speciesId:rule.speciesId},{kind:'verify',game:'firered',speciesId:rule.speciesId}]}});
  }
  const partner=selectOwnedPartnerEvolution({trainer:m.trainer,partnerAvailable:context.partnerAvailable,protectedFingerprints:context.protectedFingerprints??[]});
  if(partner&&!(dex.failed?.[partner.request.speciesId]?.retryAt>Date.now())){dex.target={speciesId:partner.request.speciesId,method:'partner-evolution'};return objective('partner-'+partner.request.speciesId,{kind:'postgame-evolve'},{evolution:partner});}
  const breeding=context.mechanics?selectOwnedBreeding({trainer:m.trainer,mechanics:context.mechanics,protectedFingerprints:context.protectedFingerprints??[]}):null;
  if(breeding&&!(dex.failed?.[breeding.speciesId]?.retryAt>Date.now())){dex.target={speciesId:breeding.speciesId,method:'breeding'};return objective('breed-'+breeding.speciesId,{kind:'postgame-acquire'},{acquisition:{kind:'breeding',...breeding}});}
  const capture=selectNationalDexCapture({o,world,mechanics:context.mechanics,state:dex});if(capture)return capture;
  const water=context.planner?.selectPokedexPreparation(o,386);
  if(water&&['surf','fishing'].includes(water.encounterMethod))return resolveFireRedTravel(water,o,world);
  return objective('source-required',{kind:'stop-for-review',reason:'No remaining local catch or ordinary evolution is currently executable. Missing entries retain their partner, breeding, gift or event requirements.'});
 }
 if(id==='fly-carrier'){
  // Long ground travel is only a fallback. Keep one verified Fly user in the
  // party; a roster swap (for example Tower balancing) may have boxed it, so
  // withdraw the recorded flyer before continuing collection goals.
  const party=m.trainer?.party??[],pc=m.trainer?.storage?.pokemon??[];
  if(party.some(p=>p.validity==='valid'&&p.moves?.includes(19)))return null;
  const flyer=pc.find(p=>p.validity==='valid'&&!p.isEgg&&p.moves?.includes(19));
  if(!flyer)return null;
  return objective('withdraw',{kind:'party-roster',map:fireRedPokemonCenter(here),minimumPartySize:2,maximumPartySize:6,
   requiredFingerprints:[encounterFingerprint(flyer)],
   requiredFamilies:party.filter(p=>p.moves?.some(move=>[19,57].includes(move))).map(p=>[p.species])});
 }
 const pendingFossil=[138,140,142].map(giftRoute).find(r=>m.storyState?.variableIds?.[0x406A]>0?m.storyState.variableIds[0x4069]===r.fossil:flag(o,r.collectedFlag)===true&&flag(o,r.flag)===false);
 const gift=id==='fossils'?pendingFossil:id==='eevee'?giftRoute(133):id==='lapras'?giftRoute(131):id==='dojo-gift'?giftRoute(m.trainer?.pokedex?.ownedSpecies?.includes(106)?107:106):null;
 const encounter=gift??STATIC_ENCOUNTERS.find(e=>e.name.toLowerCase()===id);
 if(encounter)return {id:'postgame-hunt-'+id,target:{kind:'postgame-hunt'},route:gift??{method:'static'},request:{schema:'pokemon-suite/farming-request/v1',game:'firered',speciesId:encounter.speciesId,quantity:1,locationId:'any',shiny:'required',natures:[],gender:'any',abilityId:null,ball:{id:'any',requirement:'preferred'},minIvs:{},minDvs:{},encounterLevel:{min:1,max:100},finalLevel:null,moves:[],heldItemId:null,limits:{maxEncounters:1000,maxMinutes:120,minBalls:10,maxSpend:999999},afterCompletion:'stop-save'}};
 if(id==='tanoby'){
  const party=m.trainer?.party??[];
  if(!party.some(p=>p.moves?.includes(70))){
   const mon=m.trainer?.storage?.pokemon?.find(p=>p.validity==='valid'&&!p.isEgg&&p.moves?.includes(70));
   selected=mon?objective('strength-party',{kind:'party-roster',map:fireRedPokemonCenter(here),minimumPartySize:2,maximumPartySize:6,requiredFingerprints:[encounterFingerprint(mon)],requiredFamilies:party.filter(p=>p.moves?.some(id=>[19,57].includes(id))).map(p=>[p.species])}):objective('strength-needed',{kind:'stop-for-review',reason:'Tanoby Key needs a verified Strength user in the party or PC.'});
  }else if(here!==TANOBY)selected=reach(TANOBY);
  else{
   for(const b of BOULDERS){
    const position=(m.objectEvents??[]).find(e=>!e.player&&e.localId===b.index+1)?.current;
    if(!position){selected=objective('read-boulder',{kind:'stop-for-review',reason:'Waiting for the live Tanoby boulder positions.'});break;}
    const target=b.path.at(-1);
    if(position.x===target.x&&position.y===target.y)continue;
    // Room reload restores unsolved boulders. Never assume an elapsed push worked.
    if(!b.path.some(p=>p.x===position.x&&p.y===position.y)){selected=reach('MAP_SEVEN_ISLAND_SEVAULT_CANYON');break;}
    selected=objective(`boulder-${b.index}`,{kind:'push-boulder',map:TANOBY,objectIndex:b.index,...target},{authoredBoulderPath:b.path});break;
   }
   selected??=objective('verify-unlock',{kind:'map',map:TANOBY});
  }
 }else if(id==='league-rematch'){
  if(!state.league?.baseline&&!state.league?.receipt&&Number.isInteger(m.gameStats?.leagueEntries)&&Number.isInteger(m.gameStats?.savedGame)&&o.sram?.sha256)state.league={baseline:{leagueEntries:m.gameStats.leagueEntries,savedGame:m.gameStats.savedGame,sha256:o.sram.sha256}};
  const rooms=LEAGUE_ROOMS,room=rooms.indexOf(here);
  // The opened League doorway has no static ingress route. Use the story
  // route's explicit Champion landing, preserving the retained travel owner.
  const champion=()=>objective('travel',{kind:'map-arrival',map:rooms[4],x:6,y:18});
  if(room>=0){
   if(room===4)selected=champion();
   else if(m.storyState?.flagIds?.[1208+room]!==true)selected=objective(`battle-${room}`,{kind:'object',map:rooms[room],index:0});
   else{
    const recovery=createLeagueRecovery({mechanics:context.mechanics,initialState:state.leagueRecovery});
    const result=recovery.inspect(objective(`intermission-${room}`,{kind:'heal-with-items'}),o);state.leagueRecovery=recovery.state();
    if(result.objective?.target?.kind==='stop-for-review')observeLeagueExpShareRound({o,state,inLeague:true,room,blockedReason:result.objective.target.reason,mechanics:context.mechanics,now:context.now??Date.now()});
    selected=result.complete?(room===3?champion():objective(`battle-${room+1}`,{kind:'object',map:rooms[room+1],index:0})):result.objective;
   }
  }else{
   const items=[{itemId:24,stockIndex:4,quantity:24,unitPrice:1500},{itemId:20,stockIndex:3,quantity:20,unitPrice:2500},{itemId:23,stockIndex:5,quantity:8,unitPrice:600},{itemId:19,stockIndex:2,quantity:20,unitPrice:3000}];
   const inventory=Object.values(m.trainer?.bag??{}).flat(),count=id=>inventory.filter(i=>i.itemId===id).reduce((n,i)=>n+i.quantity,0);
   const missing=items.filter(i=>count(i.itemId)<i.quantity),cost=missing.reduce((n,i)=>n+(i.quantity-count(i.itemId))*i.unitPrice,0);
   // League training never buys the basket for, or starts, a round without a
   // composed trainee: a restore step comes first, otherwise it stops for review.
   const untrained=context.requireTrainee&&(share?.composition||!share?.step&&!share?.plan?.active);
   if(context.requireTrainee&&share?.step&&!share.plan?.active)selected=objective(`exp-share-${share.step.kind}`,share.step);
   else if(untrained)selected=objective('no-trainee',{kind:'stop-for-review',reason:`No League trainee is ready: ${share?.composition?.reason??share?.plan?.reason??'no-rematch-levels'}`});
   else if(missing.length){
    selected=cost>m.trainer?.money?(context.planner?.selectIncomePreparation(o)??objective('fund-supplies',{kind:'stop-for-review',reason:`League supplies require ₽${cost}. Earn enough money before entering.`})):objective('stock-supplies',{kind:'purchase-items',map:'MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F',objectIndex:0,items:missing});
   }else if(share?.step)selected=objective(`exp-share-${share.step.kind}`,share.step);
   else if(!partyFullyRestored(m,context.mechanics))selected=event('MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F','IndigoPlateau_PokemonCenter_1F_EventScript_Nurse');
   else{
    // The round starts with this composition; later rooms keep its trainee.
    const s=state.leagueExpShare??={};s.active=Boolean(shareTrainee);
    if(shareTrainee)s.trainee=shareTrainee;
    if(context.trainingBaseline&&shareTrainee&&!state.training?.cycle)(state.training??={}).cycle={baseline:context.trainingBaseline};
    selected=objective('battle-0',{kind:'object',map:rooms[0],index:0});
   }
  }
 }else if(id==='selphy')selected=reach('MAP_FIVE_ISLAND_LOST_CAVE_ROOM10');
 else if(id==='old-amber')selected=event('MAP_PEWTER_CITY_MUSEUM_1F','PewterCity_Museum_1F_EventScript_OldAmberScientist');
 else if(id==='lorelei-visit')selected=event('MAP_FOUR_ISLAND_LORELEIS_HOUSE','FourIsland_LoreleisHouse_EventScript_Lorelei');
 return selected?resolveFireRedTravel(selected,o,world):null;
}
