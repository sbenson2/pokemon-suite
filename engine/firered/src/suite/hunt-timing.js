// Display timing is independent of emulator frames and mission safety budgets.
// Persisted totals survive restarts; the session identity excludes offline time.
export function updateHuntTiming(state,{now=Date.now(),running=false,sessionId}){
 running=running && state.status!=='complete' && state.phase!=='complete';
 const t=state.displayTiming??={sessionId,lastAt:now,active:running,phase:state.phase,elapsedMs:Math.max(0,state.elapsedMs??0),stages:{},partial:(state.elapsedMs??0)>0};
 const delta=t.sessionId===sessionId&&t.active?Math.max(0,now-t.lastAt):0;
 t.elapsedMs+=delta;t.stages[t.phase]=(t.stages[t.phase]??0)+delta;
 Object.assign(t,{sessionId,lastAt:now,active:running,phase:state.phase});
 return {elapsedMs:t.elapsedMs,phaseElapsedMs:t.stages[t.phase]??0,stages:{...t.stages},asOf:now,active:running,partial:t.partial};
}
