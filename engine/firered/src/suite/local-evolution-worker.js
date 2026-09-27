// Owns only coordination metadata. Every game input is executed by that
// game's existing Suite session; the bridge never imports another save.
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {atomicJson,digest} from './save-vault.js';
import {createNativeLocalLink} from './native-local-link.js';
import {FireRedNativeTradeHost,readNativeWirelessStatus,readNativeLinkGroup,readTradeEvolutionScene} from './native-trade-host.js';
import {createEmeraldNativeTradeAdapter} from './emerald-native-trade.js';
import {reserveLocalEvolution,verifyLocalEvolutionExchange,sameEvolutionIndividual,selectLocalTradePartner,verifyLocalTradeRestart,selectPartnerPlaceholder,verifyPartnerNetZero,pairRoles,keyedByRole,proveUncommittedLocalTrade} from './local-evolution.js';
import {partnerTradeReady} from './fire-red-evolution.js';
import {continueNativeSaveAsync,validateNativeTradeContinuation} from './native-cold-boot.js';
import {createPinnedMgbaSession} from '../emulator/pinned-mgba.js';
import {createFireRedObserver} from '../evidence/fire-red-observer.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {createCampaignPlanner} from '../player/campaign.js';
import {createPolicyAdvisors} from '../player/advisors.js';
import {createCentralPlayer} from '../player/delegator.js';

const json=p=>JSON.parse(readFileSync(p));
const read=p=>existsSync(p)?json(p):null;
const active=s=>s&&!['complete','waiting','paused','waiting-for-peer'].includes(s.phase);

export function checkpointLocalEvolution(worker,initialState){
 // An initialized worker returning null has cleared its completed exchange.
 // Only startup before worker creation may fall back to the loaded checkpoint.
 return worker ? worker.state() : initialState??null;
}

// Roles: the FireRed source owner coordinates each pair and receives the
// evolved individual back. A partner owner (the Emerald companion, or a second
// FireRed save) serves the round trip. `game` is the cartridge title; `owner`
// is the Suite owner key (directory, lock, status and RFU owner identity).
export function createLocalEvolutionWorker({game,owner=game,role=game==='firered'?'source':'partner',config,session,cartridge,coreDirectory,coreManifest,inputs,hooks,state=null}){
 let lastError=null,current=state?structuredClone(state):null,link=null,host=null,adapter=null,runtime=null,activity=null,controller=null,fieldPlayer=null,loop=null,pendingVerify=false,closed=false,lastPhase=null;
 if(!['source','partner'].includes(role)||role==='source'&&game!=='firered')throw Error('Unsupported local evolution role.');
 const pairRoot=join(config.directory,'evolution-pairs');
 const nextTrade=e=>e?.steps?.slice(e.index??0).find(s=>s.kind==='trade')??null;
 const titleOf=key=>config.games?.[key]?.title??key;
 // The source names its partner from the reservation or the next trade step.
 const sourceOwner=()=>role==='source'?owner:current?.reservation?.roles?.source?.owner??hooks.companionState?.()?.sourceOwner??'firered';
 const peerOwner=()=>{
  if(role==='partner')return sourceOwner();
  const reserved=current?.reservation?.roles?.partner?.owner;if(reserved)return reserved;
  const sourceState=hooks.fireRedState?.()??{};return nextTrade(sourceState.dexEvolution??sourceState.evolution)?.partner??'emerald';
 };
 const peer=()=>read(join(config.directory,peerOwner(),'status.json'));
 // The source is the single writer. Its default owner keeps the original
 // name; any other source owner writes under its own directory.
 const pairPath=(id,from=sourceOwner())=>from==='firered'?join(pairRoot,`${id}.json`):join(pairRoot,from,`${id}.json`);
 const record=()=>current?read(pairPath(current.requestId)):null;
 const persist=reason=>{hooks.persist(reason);hooks.progress();};
 const wait=reason=>{
  if(!current)return;
  current.phase='waiting';current.reason=reason;hooks.finishEngine(reason);persist('local-evolution-waiting');
 };
 const closeLink=()=>{link?.close();link=null;};
 // A native link failure before the exchange starts (the adapter's receive
 // queue overflowed, or the other owner's link ended) cannot have changed
 // either save. Keep the stop, close this side of the link, then cold-boot
 // this owner's unchanged native save — never a link snapshot — and prove its
 // original party and trade count, as an owner restart would. The source
 // retries the leg only after both owners prove it (at most three retries).
 // An exchange that started, or an unproven save, stays stopped for review.
 const linkFailure=error=>error?.localLinkRetry===true||/Native wireless queue overflowed/.test(error?.message??'');
 async function restartUncommitted(error){
  const reason=error?.message??String(error);
  if(!current||current.phase!=='trading'||current.receipt||pendingVerify||host?.state?.exchangeStarted||!linkFailure(error)||typeof hooks.restartNative!=='function'){wait(reason);return;}
  closeLink();hooks.finishEngine(reason);
  // A user pause during the restart keeps the pause; resuming continues here.
  const settle=(phase,text)=>{
   if(current.phase==='paused'){current.pausedPhase=phase;current.pausedReason=text;persist('local-trade-restart-verified');}
   else if(phase==='waiting')wait(text);
   else {current.phase=phase;current.reason=text;persist('local-trade-restart-verified');}
  };
  try{
   const {observation,wireless:w,sramSha256}=await hooks.restartNative(reason);
   current.trade=host.state;
   current.restartProof=proveUncommittedLocalTrade({game,...(current.reservation?.roles?{role,owner}:{}),state:current,observation,wireless:w,sramSha256});
   settle('reconciling',`The native link failed before the exchange started (${reason}) This save still holds the original party; the leg retries after the other owner verifies its save.`);
  }catch(restart){current.restartProof=null;settle('waiting',`${reason} ${restart.message}`);}
 }
 const loadRuntime=async()=>{
  if(game!=='emerald')return;
  runtime??=await hooks.getEmeraldRuntime();
  adapter??=await createEmeraldNativeTradeAdapter({runtime,researchBots:config.researchBots});
 };
 const capture=()=>game==='firered'?hooks.observe():adapter.capture();
 const wireless=()=>game!=='firered'?adapter.wireless():{...readNativeWirelessStatus(session,inputs.runtime),
  ...(role==='partner'?{guest:readNativeLinkGroup(session,inputs.runtime?.data?.symbols),evolutionScene:readTradeEvolutionScene(session,inputs.runtime?.data?.symbols)}:{})};
 const writePair=value=>{if(role!=='source')throw Error('Only the source owner coordinates the local pair.');mkdirSync(dirname(pairPath(value.requestId)),{recursive:true,mode:0o700});atomicJson(pairPath(value.requestId),value);};
 const hostOptions=(pair,o)=>{
  const r=pair.reservation,returning=pair.leg==='return',source=returning?pair.evolution.pokemon:r.source;
  const leader=role==='source',center=leader?pair.center:game==='firered'?hooks.companionState?.()?.center:'MAP_OLDALE_TOWN_POKEMON_CENTER_1F';
  return {world:game==='firered'?inputs.world:adapter.world,center,game,role:leader?'leader':'guest',peerTrainerId:pair.leaderTrainerId,
   fingerprint:leader?(returning?r.partnerFingerprint:r.sourceFingerprint):(returning?encounterFingerprint(source):r.partnerFingerprint),
   expectedPartnerFingerprint:leader?(returning?encounterFingerprint(source):r.partnerFingerprint):(returning?r.partnerFingerprint:r.sourceFingerprint)};
 };
 // The verification cold boot yields between frames: the local link stays open
 // until both receipts verify, and a synchronous boot starved this owner's
 // heartbeat while the other owner was still leaving the trade room (a native
 // run under load preserved the partner as "trade-outcome-unresolved").
 async function verifySave(){
  const sram=Buffer.from(session.saveSram());
  const check=await createPinnedMgbaSession({coreDirectory,romBytes:cartridge.bytes,cartridge:cartridge.identity,expected:{mgbaCommit:coreManifest.mgba_commit,wrapperCommit:coreManifest.wrapper_commit,mgbaWasmSha256:coreManifest.mgba_wasm_sha256}});
  let checkRuntime;
  try{
   check.loadSram(sram);let o,w;
   if(game==='firered'){
    o=await continueNativeSaveAsync(check,createFireRedObserver({session:check,...inputs,runId:'local-evolution-native-save-verification'}));w=readNativeWirelessStatus(check,inputs.runtime);
   }else{
    const {createEmeraldRuntime}=await import(pathToFileURL(join(config.researchBots,'games/emerald/player/runtime.mjs')));
    checkRuntime=await createEmeraldRuntime({romPath:config.games.emerald.cartridge.path,coreDirectory,session:check,tickets:{genderTicket:1,starterTicket:0},teamPlan:null});
    for(let n=0;n<6000&&!checkRuntime.observe().fieldReady;n++){checkRuntime.stepFrame();if(n%12===11)await new Promise(resolve=>setImmediate(resolve));}
    if(!checkRuntime.observe().fieldReady)throw Error('The native Emerald save did not continue to the field.');
    const a=await createEmeraldNativeTradeAdapter({runtime:checkRuntime,researchBots:config.researchBots});o=a.capture();w=a.wireless();
   }
   if(validateNativeTradeContinuation(o,w,host.state)!=='complete'||digest(check.saveSram())!==digest(sram))throw Error('The completed local trade did not verify in native SRAM.');
   const pokemon=o.playerMemory.trainer.party.find(p=>encounterFingerprint(p)===host.state.completion.receivedFingerprint);
   if(!pokemon)throw Error('The native received Pokémon is absent.');
   return {requestId:current.requestId,game,...(current.reservation?.roles?{role,owner}:{}),leg:current.leg,pairId:current.pairId,pokemon:structuredClone(pokemon),offeredFingerprint:host.state.fingerprint,nativeSaveVerified:true,savedSramSha256:digest(sram),savedFrame:session.frame,...host.state.completion};
  }finally{checkRuntime?.close();check.close();}
 }
 function inspect(){
  const o=capture(),d=host.inspect(o,wireless(),link.status());current.trade=host.state;
  // Persist reservations and every native phase transition, including the
  // exchange marker, before executing any following input.
  if(host.state.phase!==lastPhase){lastPhase=host.state.phase;persist('local-trade-phase');}
  if(['stop','retry','reconnect','cancelled'].includes(d.kind))throw Object.assign(Error(d.reason??'The local exchange needs reconciliation before another attempt.'),{localLinkRetry:d.kind==='retry'});
  if(d.kind==='verify-complete'){pendingVerify=true;hooks.finishEngine('Verifying the completed native exchange.');return {o,d:null};}
  return {o,d};
 }
 function emeraldFrame(){
  if(!active(current)||closed||pendingVerify)return [];
  try{
   if(controller.idle){
    const {o,d}=inspect();if(!d)return [];
    const program=d.kind==='policy'?fieldPlayer.decide(o.native,{lastResult:controller.lastResult}).program:runtime.inputProgram(d.kind==='input'?d.action.buttons:[],d.kind==='input'?3:3,d.kind==='input'?30:0);
    controller.start(program);
   }
   return controller.tick(runtime.observer.tick());
  }catch(error){wait(error.message);return [];}
 }
 async function fireRedLoop(){
  let objective;
  const base=createCampaignPlanner({world:inputs.world,story:inputs.story,mechanics:inputs.battle}),planner={...base,select:()=>objective,selectCollection:()=>null,selectTraining:()=>null,selectBattleSquad:()=>[],campaignStatus:()=>({}),state:()=>({})};
  const player=createCentralPlayer({advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,campaignPlanner:planner}),campaignPlanner:planner,mechanics:inputs.battle});
  try{
   while(active(current)&&current.phase==='trading'&&!closed&&!pendingVerify){
    const {o,d}=inspect();if(!d)break;
    let decision=null,action=d.action;
    if(d.kind==='policy'){objective=d.objective;decision=player.decide(o);if(['blocked','complete'].includes(decision.kind))throw Error(decision.reason??'The native trade approach needs repair.');action=decision.action;}
    const execution=await hooks.engine().execute(action??{buttons:[],holdFrames:3,releaseFrames:0});
    if(decision)player.observeExecution({observation:o,decision,execution});
   }
  }catch(error){if(!closed&&active(current))await restartUncommitted(error);}
 }
 function resumeTradeEngine(){
  if(current?.phase!=='trading'||pendingVerify)return;
  if(!host||!link?.status().available){wait('The native exchange connection is unavailable. Restart both owners to reconcile their native saves.');return;}
  hooks.startEngine(1,game==='emerald'?emeraldFrame:null);
  if(game==='firered')loop=fireRedLoop();
 }
 // A second FireRed partner must name its own owner, a distinct trainer ID
 // and an ordinary placeholder in its current party before joining the leader.
 function verifyFireRedPartnerJoin(pair){
  const roles=pairRoles(pair.reservation),o=capture(),trainerId=o.playerMemory?.trainer?.trainerId;
  if(roles.partner.owner!==owner||roles.source.owner===owner)throw Error('The local pair is reserved for another partner owner.');
  if(!Number.isInteger(trainerId)||trainerId!==roles.partner.trainerId||trainerId===pair.leaderTrainerId)throw Error('The FireRed partner trainer ID must match its reservation and differ from the source save.');
  if(!selectPartnerPlaceholder((o.playerMemory?.trainer?.party??[]).filter(p=>encounterFingerprint(p)===pair.reservation.partnerFingerprint)))throw Error('The partner reservation no longer matches an ordinary placeholder in its party.');
 }
 async function startTrade(pair){
  await hooks.pause('Starting the reserved native evolution trade.');await loadRuntime();
  if(!coreManifest.native_rfu)throw Error('This owner requires its verified native RFU core before trading.');
  const o=capture(),options=hostOptions(pair,o),own=o.playerMemory?.trainer?.party??[];
  if(own.filter(p=>encounterFingerprint(p)===options.fingerprint).length!==1||wireless().remotePlayers!==0)throw Error('The current party or disconnected native link does not match the reservation.');
  closeLink();current={...current,requestId:pair.requestId,reservation:pair.reservation,pairId:pair.pairId,leg:pair.leg,phase:'connecting',reason:null,trade:null,receipt:null,restartProof:null};host=new FireRedNativeTradeHost(options);current.trade=host.state;pendingVerify=false;lastPhase=null;
  // Pairs with roles authenticate both RFU owner identities (protocol v2);
  // two FireRed saves differ only by owner. Legacy pairs keep protocol v1.
  const roles=pair.reservation?.roles,other=role==='source'?'partner':'source';
  link=await createNativeLocalLink({pairId:pair.pairId,token:pair.token,role:role==='source'?'leader':'guest',game,peerGame:roles?roles[other].title:role==='source'?'emerald':'firered',
   ...(roles?{ownerId:owner,peerOwnerId:roles[other].owner}:{}),peripheral:session.attachWireless(),port:role==='source'?0:pair.port});
  if(role==='source')writePair({...pair,port:link.port,phase:'connecting'});
  if(game==='emerald'){
   controller=runtime.createActivityController();
   fieldPlayer=runtime.createActivityPlayer({current:()=>({id:'native-link-approach',plan:()=>({kind:'interact-at',map:host.state.map,x:host.attendant.x,y:host.attendant.y+2,facing:'up'})}),shoppingRemaining:()=>[],captureTargets:()=>new Set(),multichoice:()=>0});
  }
  persist('local-trade-reserved');
 }
 async function startEvolution(pair){
  closeLink();await loadRuntime();
  const r=pair.reservation,p=verifyLocalEvolutionExchange(r,'outbound',pair.outbound);
  current.outbound=pair.outbound;current.phase='evolving';current.reason=null;
  if(r.method==='trade'){
   current.evolution={requestId:r.requestId,game,...(r.roles?{owner}:{}),pokemon:p,nativeSaveVerified:true,savedSramSha256:(pair.outbound.partner??pair.outbound.emerald).savedSramSha256};current.phase='ready-for-return';persist('native-trade-evolution-verified');return;
  }
  if(!['time','beauty'].includes(r.method))throw Error('The requested receiving-game preparation is not yet executable.');
  const module=await import(pathToFileURL(join(config.researchBots,`games/emerald/player/${r.method==='beauty'?'beauty':'time'}-evolution.mjs`)));
  const createActivity=r.method==='beauty'?module.createBeautyEvolutionController:module.createTimeEvolutionController;
  activity=createActivity({runtime,requestId:r.requestId,source:p,targetSpecies:r.targetSpecies,state:current.evolutionActivity??null});
  hooks.startEngine(5,()=>{
   try{
    const d=activity.next();current.evolutionActivity=activity.state();
    if(d.kind==='complete'){current.evolution=d.receipt;current.phase='ready-for-return';hooks.finishEngine('Evolution saved; preparing the return to FireRed.');persist('receiving-evolution-native-save');return [];}
    if(['stop','wait'].includes(d.kind)){wait(d.reason);return [];}
    return d.buttons;
   }catch(error){wait(error.message);return [];}
  });persist('receiving-evolution-started');
 }
 return {
  state:()=>current?structuredClone({...current,trade:host?.state??current.trade,evolutionActivity:activity?.state()??current.evolutionActivity}):null,
  busy:()=>Boolean(current&&current.phase!=='complete'),
  // The owning emulator asks before every frame: a linked owner ahead of its
  // peer's frame clock holds (native-local-link.js).
  canAdvanceFrame:()=>link?.canAdvanceFrame?.()??true,
  status:()=>current?{requestId:current.requestId,phase:current.phase,pausedPhase:current.peerPausedPhase??current.pausedPhase??null,reason:current.reason??null,leg:current.leg,receipt:current.receipt??null,evolution:current.evolution??null,restartProof:current.restartProof??null,progress:activity?.state()?.progress??current.evolutionActivity?.progress??null}:null,
  async stop(reason,{shutdown=false}={}){closed=true;if(current&&current.phase!=='complete'&&!shutdown){if(current.phase!=='paused'){current.pausedPhase=current.phase;current.pausedReason=current.reason;}current.phase='paused';current.reason=reason;}hooks.finishEngine(reason);await loop;if(shutdown)closeLink();persist('local-evolution-stopped');},
  resume(){
   closed=false;
   if(current?.phase==='paused'){
    if(['connecting','trading'].includes(current.pausedPhase)){
     if(host&&link&&!link.status().reason){current.phase=current.pausedPhase;current.reason=null;resumeTradeEngine();}
     else {current.phase='waiting';current.reason='An interrupted native exchange must be reconciled before another attempt.';}
    }
    else {current.phase=current.pausedPhase??'waiting';current.reason=current.pausedReason??null;if(current.phase==='evolving')activity=null;}
   }
   persist('local-evolution-resumed');
  },
  async poll(){
   if(closed||!hooks.enabled())return;
   try{
    const other=peer();
    if(current&&other?.bot?.enabled===false){
     if(['complete','waiting','paused','waiting-for-peer'].includes(current.phase))return;
     const keepLink=Boolean(link&&!link.status().reason);
     if(['connecting','trading'].includes(current.phase)&&!keepLink)wait('The other game stopped during a native exchange. Reconcile the exchange before another attempt.');
     else {
      current.peerPausedPhase=current.phase;current.phase='waiting-for-peer';current.reason='The other game’s bot was stopped. The reserved evolution will resume when it is enabled.';
      hooks.finishEngine(current.reason);await loop;activity=null;persist('local-evolution-peer-paused');
     }
     if(!keepLink)closeLink();return;
    }
    if(current?.phase==='waiting-for-peer'){
     if(other?.bot?.enabled!==true)return;
     current.phase=current.peerPausedPhase;current.peerPausedPhase=null;current.reason=null;resumeTradeEngine();persist('local-evolution-peer-resumed');
    }
    if(current?.phase==='complete'&&role==='source'&&(hooks.fireRedState()?.dexEvolution??hooks.fireRedState()?.evolution)?.requestId!==current.requestId){current=null;host=null;activity=null;}
    if(current?.phase==='complete'&&role==='partner'&&hooks.companionState()?.requestId!==current.requestId){current=null;host=null;activity=null;}
    if(!current){
     if(role==='source'){
      const sourceState=hooks.fireRedState()??{},evolution=sourceState.dexEvolution??sourceState.evolution,preparation=sourceState.preparation;
      const ready=other?.bot?.preparation;
      // The request can report waiting-for-transfer before its trade
      // preparation (source and center) exists; wait for that preparation.
      if(preparation?.phase!=='waiting-for-transfer'||!preparation.tradePreparation?.pokemon||ready?.phase!=='ready-for-transfer'||ready.requestId!==evolution?.requestId||!ready.transferCandidate)return;
      // A FireRed partner trades through its native link core (nativeRadio);
      // its top-level core is the stock base core, as for the source FireRed.
      const step=nextTrade(evolution),partnerOwner=step?.partner??'emerald',partnerCfg=config.games?.[partnerOwner];
      const partnerCore=step?.partner!==undefined?partnerCfg?.nativeRadio?.core??partnerCfg?.core:partnerCfg?.core;
      if(!coreManifest.native_rfu||!partnerCore||!json(join(partnerCore,'build-manifest.json')).native_rfu)return;
      const o=hooks.observe(),leaderTrainerId=o.playerMemory?.trainer?.trainerId;
      if(!Number.isInteger(leaderTrainerId))throw Error('The native FireRed trainer identity is unavailable.');
      if(step?.partner!==undefined){
       // FireRed–FireRed: two owners, two trainer IDs, the Pokédex on both saves
       // and the National Dex on both for a species outside #1–151.
       if(titleOf(partnerOwner)!=='firered'||ready.owner!==partnerOwner||partnerOwner===owner)throw Error('The FireRed partner owner does not match this evolution route.');
       if(ready.trainerId===leaderTrainerId)throw Error('The FireRed partner save has the same trainer ID as this save. Two distinct saves are required.');
       const national=[step.speciesId,step.evolution?.speciesId].some(id=>id>151);
       if(!partnerTradeReady(o.playerMemory?.storyState?.flagIds,step)||ready.pokedex!==true||national&&ready.nationalDex!==true)throw Error('Both FireRed saves need the Pokédex, and the National Pokédex for a species outside #1–151, before this trade.');
      }
      const reservation=reserveLocalEvolution({evolution,source:preparation.tradePreparation.pokemon,partner:ready.transferCandidate,sourceOwner:owner,sourceTrainerId:leaderTrainerId,partnerTrainerId:ready.trainerId??null});
      if(!['time','trade','beauty'].includes(reservation.method))return;
      const pair={schema:step?.partner!==undefined?'pokemon-suite/local-evolution-pair/v2':'pokemon-suite/local-evolution-pair/v1',requestId:reservation.requestId,reservation,leaderTrainerId,center:preparation.tradePreparation.center,pairId:randomUUID(),token:randomBytes(32).toString('hex'),leg:'outbound',phase:'connecting'};
      await startTrade(pair);
     }else{
      const preparation=hooks.companionState();
      if(preparation?.phase!=='ready-for-transfer')return;
      const pair=read(pairPath(preparation.requestId,preparation.sourceOwner??'firered'));
      if(pair?.phase!=='connecting'||pair.leg!=='outbound'||!pair.port||pair.requestId!==preparation.requestId)return;
      const roles=pairRoles(pair.reservation);
      if(roles.partner.owner!==owner||roles.partner.title!==game)return; // reserved for another partner owner
      if(game==='firered')verifyFireRedPartnerJoin(pair);
      else{
       await loadRuntime();
       if(!selectLocalTradePartner(runtime.observe().party.filter(p=>encounterFingerprint(p)===pair.reservation.partnerFingerprint)))throw Error('The companion reservation no longer matches an eligible party member.');
      }
      await startTrade(pair);
     }
    }
    if(!current||['waiting','paused','complete','waiting-for-peer'].includes(current.phase))return;
    let pair=record();
    if(current.phase==='reconciling'){
     if(role==='source'){
      const otherProof=other?.localEvolution?.restartProof;
      if(!otherProof||other?.localEvolution?.phase!=='reconciling')return;
      const evidence=keyedByRole(pair.reservation,current.restartProof,otherProof);
      verifyLocalTradeRestart(pair,evidence);
      await startTrade({...pair,restarts:(pair.restarts??0)+1,previousPairId:pair.pairId,restartEvidence:evidence,pairId:randomUUID(),token:randomBytes(32).toString('hex'),port:null,phase:'connecting'});
     }else if(pair?.phase==='connecting'&&pair.previousPairId===current.pairId&&pair.leg===current.leg&&pair.port){
      verifyLocalTradeRestart({...pair,pairId:pair.previousPairId,restarts:pair.restarts-1},pair.restartEvidence);
      if((pair.restartEvidence.partner??pair.restartEvidence.emerald)?.savedSramSha256!==current.restartProof?.savedSramSha256)throw Error('The native restart proof no longer matches this owner.');
      await startTrade(pair);
     }
     return;
    }
    if(role==='partner'&&current.phase==='evolving'&&!activity&&pair?.phase==='evolving')await startEvolution(pair);
    if(current.phase==='connecting'&&link?.status().reason)throw Error(link.status().reason);
    if(current.phase==='connecting'&&link?.status().available){
     current.phase='trading';hooks.startEngine(1,game==='emerald'?emeraldFrame:null);persist('local-trade-started');
     if(game==='firered')loop=fireRedLoop();
    }
    if(pendingVerify){
     pendingVerify=false;await loop;current.receipt=await verifySave();host.state.phase='complete';current.phase='waiting-for-peer-save';persist('local-trade-native-save-verified');
    }
    if(role==='source'&&current.phase==='waiting-for-peer-save'){
     const otherReceipt=peer()?.localEvolution?.receipt;
     if(otherReceipt?.pairId!==current.pairId||otherReceipt.leg!==current.leg)return;
     const both=keyedByRole(current.reservation,current.receipt,otherReceipt);verifyLocalEvolutionExchange(current.reservation,current.leg,both);closeLink();
     if(current.leg==='outbound'){
      current.outbound=both;current.phase='waiting-for-evolution';writePair({...pair,phase:'evolving',outbound:both});persist('both-outbound-native-saves-verified');
     }else{
      const result={reservation:current.reservation,outbound:current.outbound,returned:both,evolution:pair.evolution};await hooks.acceptRoundTrip(result,capture());
      current.phase='complete';current.returned=both;writePair({...pair,phase:'complete',returned:both});persist('evolution-return-verified');
     }
    }
    pair=record();
    if(role==='partner'&&current.phase==='waiting-for-peer-save'&&current.leg==='outbound'&&pair?.phase==='evolving')await startEvolution(pair);
    if(role==='source'&&current.phase==='waiting-for-evolution'){
     const otherState=peer()?.localEvolution,e=otherState?.evolution;
     if(otherState?.requestId!==current.requestId||otherState.phase!=='ready-for-return')return;
     if(!e?.nativeSaveVerified||!sameEvolutionIndividual(current.reservation.source,e.pokemon))throw Error('The receiving evolution does not verify the reserved individual.');
     await startTrade({...pair,phase:'connecting',leg:'return',evolution:e,pairId:randomUUID(),token:randomBytes(32).toString('hex'),port:null});
    }
    if(role==='partner'&&current.phase==='ready-for-return'&&pair?.phase==='connecting'&&pair.leg==='return'&&pair.port)await startTrade(pair);
    if(role==='partner'&&current.phase==='waiting-for-peer-save'&&current.leg==='return'&&pair?.phase==='complete'){
     verifyLocalEvolutionExchange(current.reservation,'return',pair.returned);closeLink();
     // Net zero for a FireRed partner: exactly its original party and PC again.
     if(game==='firered'){const trainer=capture().playerMemory?.trainer;verifyPartnerNetZero(hooks.companionState()?.holdings,trainer);current.netZeroVerified=true;}
     current.phase='complete';persist('companion-return-verified');
    }
    if(Date.now()-(current.progressAt??0)>1000){current.progressAt=Date.now();hooks.progress();}
   }catch(error){
    wait(error.message);
    // A refused reservation repeats every poll; log each distinct reason once.
    if(error.message!==lastError){lastError=error.message;console.error(error.stack);}
   }
  },
 };
}
