// Older controllers left the active clock running while blocked. A later
// Pause charged the whole review interval. Correct only a checkpoint whose
// retained menu stop proves the watchdog had time remaining at suspension.
export function restoreCampaignAccounting(state,record,progressTimeoutMs) {
  const supervision=state?.supervision;
  const unchanged={supervision,repair:state?.supervisionAccountingRepair??null};
  const stop=state?.recovery?.current;
  if(!supervision||state.activityAccounting!=null||
      !['blocked','paused'].includes(state.status)||
      ![null,'no-meaningful-progress'].includes(supervision.stopReason)||
      state.player?.transactionRecovery?.blocked?.reason!=='repeated-menu-transaction'||
      stop?.status!=='needs-review'||stop.action!=='resume-campaign'||stop.reason!=='repeated-menu-transaction')return unchanged;
  let key;try{key=JSON.parse(stop.key);}catch{return unchanged;}
  if(!Array.isArray(key)||key.length!==4||key[0]!==record.id||key[1]!=='campaign-menu')return unchanged;
  const timeout=progressTimeoutMs??supervision.progressTimeoutMs??900000;
  const stoppedIdleMs=stop.finishedAt-Date.parse(supervision.lastProgressAt);
  if(!Number.isFinite(stop.startedAt)||!Number.isFinite(stop.finishedAt)||stop.finishedAt<stop.startedAt||
      !Number.isFinite(stoppedIdleMs)||stoppedIdleMs<0||stoppedIdleMs>=timeout||
      supervision.idleMs<timeout||supervision.elapsedMs<supervision.idleMs-stoppedIdleMs)return unchanged;
  const recent=supervision.recent??[];
  const index=recent.findIndex(row=>row.map===key[2]&&row.objective===key[3]&&row.decision==='blocked');
  if(index<0||recent.slice(index).some(row=>row.map!==key[2]||row.decision!=='blocked'||row.action))return unchanged;
  const excludedMs=supervision.idleMs-stoppedIdleMs;
  return {supervision:{...supervision,idleMs:stoppedIdleMs,elapsedMs:supervision.elapsedMs-excludedMs,stopReason:null},
    repair:{schema:'pokemon-suite/supervision-accounting-repair/v1',reason:'legacy-blocked-review-time',
      recoveryKey:stop.key,finishedAt:stop.finishedAt,excludedMs,
      previous:{idleMs:supervision.idleMs,elapsedMs:supervision.elapsedMs,stopReason:supervision.stopReason}}};
}
