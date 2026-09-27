import {isProgressObservation} from './progress-observation.js';
import {createCampaignSearchProgress} from './campaign-search-progress.js';

export const DEFAULT_CAMPAIGN_PROGRESS_TIMEOUT_MS = 5 * 60_000;

// Shared by the live campaign and qualification recorder. Only time spent in
// an active owner counts; restoring a save preserves consumed budget, not a
// process-local clock origin or time spent offline.
export function createCampaignSupervisor({clock=Date.now,progressTimeoutMs=DEFAULT_CAMPAIGN_PROGRESS_TIMEOUT_MS,initialState=null}={}) {
  if(!Number.isFinite(progressTimeoutMs)||progressTimeoutMs<=0)throw new TypeError('campaign progress timeout must be positive');
  if(initialState!==null && (initialState.schema!=='master-red/campaign-supervisor/v1'||
      !Number.isFinite(initialState.idleMs)||initialState.idleMs<0||
      !Number.isFinite(initialState.elapsedMs)||initialState.elapsedMs<0||
      !Array.isArray(initialState.achievements)||initialState.achievements.some(k=>typeof k!=='string')||
      initialState.watched!==undefined&&(!Array.isArray(initialState.watched)||initialState.watched.some(k=>typeof k!=='string'))||
      !Array.isArray(initialState.experience)||initialState.experience.some(e=>!Array.isArray(e)||e.length!==2||typeof e[0]!=='string'||!Number.isFinite(e[1]))||
      ![null,'no-meaningful-progress'].includes(initialState.stopReason)||
      initialState.reviewedRetries!==undefined&&(!Array.isArray(initialState.reviewedRetries)||initialState.reviewedRetries.length>3||
        initialState.reviewedRetries.some(r=>r?.reason!=='no-meaningful-progress'||!Number.isFinite(r.idleMs)||r.idleMs<0||!Number.isFinite(r.elapsedMs)||r.elapsedMs<0))))throw new TypeError('invalid campaign supervisor checkpoint');
  let idleMs=initialState?.idleMs??0,elapsedMs=initialState?.elapsedMs??0;
  let lastProgressAt=initialState?.lastProgressAt??null,stopReason=initialState?.stopReason??null;
  let anchor=clock(),paused=false;
  const achievements=new Set(initialState?.achievements??[]),experience=new Map(initialState?.experience??[]);
  // Story values this run has observed. An engine update can watch another
  // flag or variable; its first reading is a baseline, never progress, so the
  // update cannot renew a retained budget. Older checkpoints watched every
  // variable they hold an achievement for and every flag they saw set.
  const watched=new Set(initialState?.watched??[...achievements].flatMap(key=>/^(?:flag|variable):\d+/.exec(key)??[]));
  const search=createCampaignSearchProgress(initialState?.search??null);
  let recent=structuredClone(initialState?.recent??[]).slice(-32);
  const reviewedRetries=structuredClone(initialState?.reviewedRetries??[]);
  const automaticRecoveries=structuredClone(initialState?.automaticRecoveries??[]);
  if(!Array.isArray(automaticRecoveries)||automaticRecoveries.length>100)throw new TypeError('invalid automatic recovery history');
  const account=()=>{const now=clock();if(!paused){const delta=Math.max(0,now-anchor);idleMs+=delta;elapsedMs+=delta;}anchor=now;return now;};
  const status=()=>({stopReason,idleMs,elapsedMs,progressTimeoutMs,lastProgressAt,recent:structuredClone(recent)});
  function recordDecision({observation,decision=null,objective=null,task=null}={}) {
    if(!paused&&!stopReason)search.recordDecision({observation,decision});
    const row={map:observation?.playerMemory?.map?.id??null,objective:objective?.id??null,
      task:task?{kind:task.kind,phase:task.phase,parentObjectiveId:task.parentObjectiveId}:null,
      decision:decision?.kind??null,action:decision?.winner?.recommendation?.kind??null};
    const key=JSON.stringify(row),previous=recent.at(-1);
    if(previous?.key===key){previous.frame=observation?.frame??null;previous.repeats++;}
    else recent=[...recent,{...row,key,frame:observation?.frame??null,repeats:1}].slice(-32);
  }
  return {
    observe({observation,decision=null,objective=null,task=null,completedThroughObjectiveId=null}={}) {
      const now=account();let progressed=false;
      const achieve=key=>{if(!achievements.has(key)){achievements.add(key);progressed=true;}};
      const story=(id,key)=>{if(watched.has(id)){if(key)achieve(key);}else{watched.add(id);if(key)achievements.add(key);}};
      if(!paused&&!stopReason&&isProgressObservation(observation)) {
        progressed=search.observe(observation,objective);
        const m=observation.playerMemory;
        achieve(`map:${m.map.id}`);
        for(const [id,value] of Object.entries(m.storyState?.flagIds??{}))story(`flag:${id}`,value?`flag:${id}`:null);
        for(const [id,value] of Object.entries(m.storyState?.variableIds??{}))story(`variable:${id}`,`variable:${id}:${value}`);
        if(completedThroughObjectiveId)achieve(`objective:${completedThroughObjectiveId}`);
        for(const member of m.trainer?.party??[]) {
          const key=JSON.stringify([member.otId??null,member.personality??member.species]);
          const earned=Number(member.experience??member.level??0);
          if(Number.isFinite(earned)&&earned>(experience.get(key)??-1)){
            experience.set(key,earned);
            if(task?.kind!=='training'||task.member===key)progressed=true;
          }
        }
        if(progressed){idleMs=0;lastProgressAt=new Date(now).toISOString();}
      }
      if(!paused&&!stopReason&&idleMs>=progressTimeoutMs)stopReason='no-meaningful-progress';
      if(decision)recordDecision({observation,decision,objective,task});
      return status();
    },
    recordDecision,
    pause(){account();paused=true;},
    resume(){anchor=clock();paused=false;},
    beginRecovery(strategy){
      if(!strategy||!['alternate-healer','alternate-training'].includes(strategy.kind)||!strategy.from||!strategy.to||
          JSON.stringify(strategy.from)===JSON.stringify(strategy.to))return false;
      const key=JSON.stringify(strategy);
      if(automaticRecoveries.some(r=>r.key===key)||automaticRecoveries.filter(r=>r.objective===(strategy.objective??null)).length>=3)return false;
      account();automaticRecoveries.push({key,objective:strategy.objective??null,strategy:structuredClone(strategy),idleMs,elapsedMs,at:new Date(clock()).toISOString()});
      // A qualified alternative receives a new budget. Keep total time and
      // the failed strategy; this is not evidence that it has recovered.
      idleMs=0;stopReason=null;anchor=clock();return true;
    },
    retryReviewedStop({objective=null,frame=null}={}) {
      if(stopReason!=='no-meaningful-progress')throw Error('There is no campaign progress stop to review.');
      if(reviewedRetries.length>=3)throw Error('The campaign has reached its reviewed stall retry limit.');
      // Only the explicit policy-retry path calls this, after preserving the
      // stop report. Automatic resume and update handoff retain the latch.
      reviewedRetries.push({reason:stopReason,idleMs,elapsedMs,objective,frame,at:new Date(clock()).toISOString()});
      idleMs=0;stopReason=null;anchor=clock();
    },
    status,
    state:()=>({schema:'master-red/campaign-supervisor/v1',idleMs,elapsedMs,progressTimeoutMs,lastProgressAt,stopReason,
      achievements:[...achievements],...(watched.size?{watched:[...watched]}:{}),experience:[...experience],search:search.state(),recent:structuredClone(recent),
      ...(reviewedRetries.length?{reviewedRetries:structuredClone(reviewedRetries)}:{}),
      ...(automaticRecoveries.length?{automaticRecoveries:structuredClone(automaticRecoveries)}:{})}),
  };
}
