import {canContinueRoamerTracking} from './roamer-flight.js';
import {canRetryProtectedCapture,canRetryDepletedCapture,canQualifyPostgameCapture,ownedCaptureCount} from '../rng/protected-capture-plan.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';

const MENU_FAILURES=new Set(['repeated-menu-transaction']);
export function replanAfterRecovery(state,requested=null){
 if(!state)return null;
 if(requested){
  const o=requested.observation;
  if(requested.explicitRetry!==true||!MENU_FAILURES.has(state.transactionRecovery?.blocked?.reason)||
     requested.mission?.protected||state.encounterSafety?.capture||state.workflow?.kind==='in-game-trade'||
     o?.phase!=='stable'||o.emulator?.inBattle||o.playerMemory?.ui?.saveDialog)return state;
  if(!Array.isArray(requested.qualification?.interventions))throw Error('The requested policy retry needs its qualification record.');
  requested.qualification.interventions.push({type:'policy-retry',frame:o.frame,at:new Date().toISOString(),
   reason:state.transactionRecovery.blocked.reason,runtimeLock:requested.runtimeLock,plannerLock:requested.plannerLock});
 }
 return {...structuredClone(state),...(requested?{workflow:null}:{}),transactionRecovery:null,movementRecovery:null};
}
export function assessRecovery({enabled,running,manual=false,localBusy=false,mission,postgame,evidence,wireless,nativeTrade,interruptedRecovery,observation:o}){
 const none={action:'none'};
 if(!enabled||running||manual||localBusy||!mission||wireless?.remotePlayers!==0||nativeTrade&&!(nativeTrade.phase==='complete'&&nativeTrade.completion?.nativeSaveVerified&&nativeTrade.completion?.handshakeVerified))return none;
 if(o?.phase!=='stable'||o.playerMemory?.ui?.saveDialog?.stage==='writing')return none;
 const interrupted=interruptedRecovery?.status==='recovering'&&interruptedRecovery.huntId===mission.id;
 if(interrupted){
  if(interruptedRecovery.action==='resume-postgame'&&postgame)return {...interruptedRecovery,action:'resume-postgame'};
  if(canContinueRoamerTracking({mission,observation:o,evidence}))return {...interruptedRecovery,action:'resume-mission'};
  if(canRetryProtectedCapture({observation:o,evidence,source:mission.protectedAnchor})||canRetryDepletedCapture({observation:o,evidence,source:mission.protectedAnchor}))return {...interruptedRecovery,action:'retry-capture'};
  if(!mission.protected||evidence?.fingerprint&&(ownedCaptureCount(o,evidence.fingerprint)===1||o.emulator.inBattle&&encounterFingerprint(o.playerMemory.encounter?.pokemon)===evidence.fingerprint))return {...interruptedRecovery,action:'resume-mission'};
  return none;
 }
 if(mission.status==='paused')return none;
 let action,reason,objective;
 if(mission.status==='blocked'&&mission.reason==='protected-encounter-lost-or-unverified'&&canContinueRoamerTracking({mission,observation:o,evidence})){
  action='resume-mission';reason='verified-roamer-flight';objective=evidence.fingerprint;
 }else if(mission.status==='blocked'&&mission.protected&&mission.reason==='protected-encounter-lost-or-unverified'&&canRetryProtectedCapture({observation:o,evidence,source:mission.protectedAnchor})){
  action='retry-capture';reason=mission.reason;objective=evidence.fingerprint;
 }else if(mission.status==='blocked'&&mission.protected&&mission.reason==='capture-balls-exhausted'&&canRetryDepletedCapture({observation:o,evidence,source:mission.protectedAnchor})){
  action='retry-capture';reason=mission.reason;objective=evidence.fingerprint;
 }else if(mission.status==='blocked'&&mission.reason==='repeated-navigation-cycle'&&mission.navigationCycle?.objective&&!mission.protected&&!o.emulator.inBattle){
  const cycle=mission.navigationCycle;action='resume-mission';reason=mission.reason;
  return {action,reason,huntId:mission.id,cycle,key:JSON.stringify([mission.id,action,reason,cycle.objective])};
 }else if(postgame?.status==='waiting'&&canQualifyPostgameCapture(o,postgame.player?.encounterSafety?.capture,postgame.reason)){
  action='resume-postgame';reason=postgame.reason;objective=postgame.player.encounterSafety.capture.fingerprint;
 }else if(postgame?.status==='waiting'&&MENU_FAILURES.has(postgame.reason)){
  action='resume-postgame';reason=postgame.reason;objective=postgame.objective?.id??'postgame';
 }else if(mission.status==='blocked'&&MENU_FAILURES.has(mission.reason)&&!o.emulator.inBattle){
  action='resume-mission';reason=mission.reason;objective=mission.phase;
 }else return none;
 return {action,reason,huntId:mission.id,key:JSON.stringify([mission.id,action,reason,o.playerMemory?.map?.id,objective])};
}
export function createRecoveryLedger(state=null){
 if(state&&state.schema!=='pokemon-suite/recovery/v1')throw Error('Invalid automatic recovery ledger');
 const data=structuredClone(state??{schema:'pokemon-suite/recovery/v1',incidents:{},history:[],current:null});
 return {
  state:()=>structuredClone(data),
  begin(candidate,now=Date.now()){
   if(!candidate?.key||candidate.action==='none')return {allowed:false,reason:'not-recoverable'};
   const previous=data.incidents[candidate.key];
   if((previous?.attempts??0)>=3)return {allowed:false,reason:'attempt-limit'};
   if(now<(previous?.nextAttemptAt??0))return {allowed:false,reason:'cooldown'};
   const attempts=(previous?.attempts??0)+1;
   data.incidents[candidate.key]={attempts,nextAttemptAt:now+5000*2**(attempts-1)};
   data.current={...candidate,status:'recovering',attempt:attempts,startedAt:now};
   data.history.push({...data.current});data.history=data.history.slice(-100);
   return {allowed:true,attempt:attempts};
  },
  finish(status,detail,now=Date.now()){
   if(!data.current)return;
   data.current={...data.current,status,detail,finishedAt:now};data.history.push({...data.current});data.history=data.history.slice(-100);
  },
 };
}
export function botHealth({enabled,running,mission,postgame,recovery}){
 if(!enabled)return {status:'stopped',reason:'Stopped by you.'};
 if(postgame?.status==='waiting')return {status:'blocked',reason:postgame.reason,progress:postgame.health};
 if(running&&postgame?.status==='recovering')return {status:'recovering',reason:postgame.reason,progress:postgame.health};
 if(running&&postgame?.status==='dependency')return {status:'waiting',reason:postgame.reason};
 if(running)return {status:recovery?.status==='recovering'?'recovering':'running',reason:null,...(postgame?.health?{progress:postgame.health}:{})};
 if(recovery?.status==='needs-review')return {status:'blocked',reason:recovery.detail};
 if(recovery?.status==='recovering')return {status:'recovering',reason:'Checking the interrupted recovery before resuming.'};
 if(mission?.status==='blocked')return {status:'blocked',reason:mission.reason};
 if(postgame?.status==='waiting')return {status:'blocked',reason:postgame.reason};
 return {status:'ready',reason:null};
}
