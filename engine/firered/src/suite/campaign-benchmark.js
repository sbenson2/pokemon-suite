// Measurement only. No planner decisions, input, or game-memory writes.
import {createCampaignDiagnostics} from './campaign-diagnostics.js';
const SCHEMA='pokemon-suite/campaign-benchmark/v1';
const FPS=59.7275;
const finite=n=>Number.isFinite(n)&&n>=0;
const copy=structuredClone;
const playSeconds=p=>p&&[p.hours,p.minutes,p.seconds].every(finite)?p.hours*3600+p.minutes*60+p.seconds:null;
const counters=m=>Object.fromEntries(Object.entries(m?.gameStats??{}).filter(([,n])=>finite(n)));
const duration=()=>({activeRealMs:0,frames:0});
function activity(o) {
 const m=o.playerMemory??{},ui=m.ui??{};
 if(o.emulator?.inBattle)return 'battle';
 if(ui.saveDialog)return 'saving';
 if(ui.mart)return 'shopping';
 if(Object.values(ui).some(Boolean))return 'menus';
 return o.emulator?.mode==='overworld'?'travel':'transitions';
}
function purpose(c) {
 if(c.status==='finishing'||c.completion)return 'league-completion';
 return c.task?.kind??'story';
}

export function createCampaignBenchmark({run,mechanics={},state=null,clock=Date.now}) {
 if(!run?.id||state&&(state.schema!==SCHEMA||state.runId!==run.id))throw Error('Benchmark belongs to a different campaign.');
 let data=state?copy(state):{schema:SCHEMA,runId:run.id,runCreatedAt:run.createdAt,
  seed:run.seed,teamSeed:run.teamSeed,commitment:run.commitment,status:'recording',partial:true,
  recordingStartedAt:null,finishedAt:null,baseline:null,last:null,
  recorded:duration(),outsideAutomation:{frames:0},activities:{},purposes:{},objectives:{},segments:[],milestones:[],interruptions:[],
  observed:{decisions:0,battleTurns:0,partySwitches:0},work:{},nativeCounters:{},completion:null};
 const diagnostics=createCampaignDiagnostics({run,mechanics,state:data.diagnostics??null});delete data.diagnostics;
 data.outsideAutomation??={frames:0};
 function diagnose(fn){
  const started=performance.now();
  try{fn();}catch(error){diagnostics.measurementError(`Measurement unavailable: ${error.message}`);}
  measure('diagnostics',performance.now()-started);
 }
 function measure(name,ms) {
  if(data.status==='complete'||!finite(ms))return;
  if(!['observation','planner','plannerCpu','plannerSnapshot','execution','executionFeedback','persistence','diagnostics'].includes(name))throw Error('Unknown campaign measurement.');
  const t=data.work[name]??={calls:0,totalMs:0,maxMs:0};t.calls++;t.totalMs+=ms;t.maxMs=Math.max(t.maxMs,ms);
 }
 function decision(d,context=null) {
  if(data.status==='complete')return;
  data.observed.decisions++;
  const kind=d?.winner?.recommendation?.kind??d?.kind??'unknown';
  data.decisionKinds??={};data.decisionKinds[kind]=(data.decisionKinds[kind]??0)+1;
  if(context)diagnose(()=>diagnostics.decide(context.observation,d,context.campaign));
 }
 function sample({observation:o,campaign:c,sessionId,runtimeLock,speed=1,controlMode='bot',qualification=null}) {
  if(data.status==='complete'||!o||!finite(o.frame)||!c||!finite(c.supervision?.elapsedMs))return;
  const automated=controlMode==='bot'&&['running','finishing','complete'].includes(c.status);
  diagnose(()=>automated?diagnostics.observe(o,c):diagnostics.suspend(o,c));
  const now=clock(),m=o.playerMemory??{},activeRealMs=c.supervision.elapsedMs;
  const current={at:now,frame:o.frame,activeRealMs,status:c.status,automated,activity:activity(o),purpose:purpose(c),
   objective:c.objective?.id??'starting',inBattle:Boolean(o.emulator?.inBattle),
   turn:m.battle?.turn??null,slot:m.battle?.playerPartySlot??null};
  const native=counters(m),play=playSeconds(m.trainer?.playTime);
  if(!data.baseline) {
   data.recordingStartedAt=new Date(now).toISOString();data.partial=c.hasStarted!==false;
   data.baseline={frame:o.frame,activeRealMs,nativePlayTimeSeconds:play,nativeCounters:copy(native)};
  }
  const previous=data.last;
  if(previous) {
   const delta={activeRealMs:Math.max(0,activeRealMs-previous.activeRealMs),frames:Math.max(0,o.frame-previous.frame)};
   if(!previous.automated||!current.automated){data.outsideAutomation.frames+=delta.frames;delta.frames=0;}
   for(const target of [data.recorded,data.activities[previous.activity]??=duration(),
     data.purposes[previous.purpose]??=duration(),data.objectives[previous.objective]??=duration(),data.segments.at(-1)]) {
    if(target){target.activeRealMs+=delta.activeRealMs;target.frames+=delta.frames;}
   }
   if(o.frame<previous.frame||activeRealMs<previous.activeRealMs) {
    data.interruptions.push({at:new Date(now).toISOString(),frame:o.frame,reason:'measurement-counter-rebased',previousFrame:previous.frame});
   }
   if(previous.automated&&current.automated&&previous.inBattle&&current.inBattle&&o.frame>previous.frame) {
    if(finite(current.turn)&&finite(previous.turn)&&current.turn>=previous.turn)data.observed.battleTurns+=current.turn-previous.turn;
   }
  }
  const segmentKey=JSON.stringify([sessionId,runtimeLock,speed]);
  if(data.segments.at(-1)?.key!==segmentKey) {
   data.segments.push({key:segmentKey,sessionId,runtimeLock:copy(runtimeLock??null),requestedSpeed:speed,
    startedAt:new Date(now).toISOString(),startFrame:o.frame,startActiveRealMs:activeRealMs,...duration()});
  }
  const first=data.milestones.find(e=>e.objective===current.objective);
  if(!first)data.milestones.push({objective:current.objective,firstObservedAt:new Date(now).toISOString(),frame:o.frame,activeRealMs});
  if(['blocked','paused'].includes(c.status)&&previous?.status!==c.status) {
   data.interruptions.push({at:new Date(now).toISOString(),frame:o.frame,status:c.status,reason:c.reason??c.status});
  }
  data.status=c.status==='blocked'?'blocked':c.status==='paused'?'paused':'recording';
  data.last=current;data.campaignActiveRealMs=activeRealMs;data.qualification=copy(qualification);
  if(Object.keys(native).length)data.nativeCounters=native;
  if(play!==null)data.nativePlayTimeSeconds=play;
  const completion=c.completion;
  if(c.status==='complete'&&completion?.playablePostgame===true&&completion.nativeHallOfFame?.nativeSaveVerified===true&&
    /^[a-f0-9]{64}$/.test(completion.nativeHallOfFame.sramSha256??'')&&/^[a-f0-9]{64}$/.test(completion.sramSha256??'')&&
    o.phase==='stable'&&o.emulator?.mode==='overworld'&&!o.emulator.inBattle&&!m.questLog?.playback) {
   data.status='complete';data.completion=copy(completion);data.finishedAt=new Date(now).toISOString();
  }
 }
 function summary({compact=false}={}) {
  const {last, ...result}=copy(data);
  const end=data.finishedAt?Date.parse(data.finishedAt):clock();
  result.recorded.wallMs=data.recordingStartedAt?Math.max(0,end-Date.parse(data.recordingStartedAt)):0;
  result.recorded.emulatedSeconds=data.recorded.frames/FPS;
  result.recorded.achievedSpeed=data.recorded.activeRealMs>0?data.recorded.frames/FPS/(data.recorded.activeRealMs/1000):null;
  result.nativeCounterDelta=Object.fromEntries(Object.entries(data.baseline?.nativeCounters??{})
   .filter(([k,n])=>finite(data.nativeCounters[k])&&data.nativeCounters[k]>=n).map(([k,n])=>[k,data.nativeCounters[k]-n]));
  for(const segment of result.segments) {
   delete segment.key;segment.achievedSpeed=segment.activeRealMs>0?segment.frames/FPS/(segment.activeRealMs/1000):null;
  }
  result.updatedAt=last?new Date(last.at).toISOString():null;
  result.diagnostics=diagnostics.summary();
  result.observed.partySwitches=result.diagnostics.totals.switches;
  if(compact){result.diagnostics.recent=result.diagnostics.recent.slice(-6);result.diagnostics.battles=result.diagnostics.battles.slice(-4);}
  return result;
 }
 return {sample,measure,decision,summary,state:()=>({...copy(data),diagnostics:diagnostics.state()}),
  execution:update=>diagnose(()=>diagnostics.execution(update)),pendingEvents:diagnostics.pendingEvents,ackEvents:diagnostics.ackEvents,archiveError:diagnostics.archiveError};
}
