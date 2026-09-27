import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';

// The owner, not the planning worker, owns this deadline and restart journal.
// Retrying a pure planner call never repeats an emulator action. Feedback is
// replayed from the last acknowledged snapshot, before that feedback existed.
export function createPlannerClient({module,options,snapshot,kind='campaign',resumingCommands=[],timeoutMs=30000,restartLimit=2}){
 if(!['campaign','postgame'].includes(kind))throw Error('Unsupported planner kind.');
 if(!Array.isArray(resumingCommands)||resumingCommands.some(name=>typeof name!=='string'))throw Error('Invalid resuming planner commands.');
 const resumes=new Set(resumingCommands);
 let mirror=structuredClone(snapshot),worker=null,generation=null,sequence=0,closed=false,pending=null,tail=Promise.resolve(),control=null,epoch=0,storyFrame=null,busy=0;
 const timing={calls:0,roundTripMs:0,computeMs:0,snapshotMs:0};
 const journal=structuredClone(options.state?.plannerSupervision??snapshot.state?.plannerSupervision??{schema:'pokemon-suite/planner-supervision/v1',incidents:{},history:[]});
 if(journal.schema!=='pokemon-suite/planner-supervision/v1'||!journal.incidents||!Array.isArray(journal.history)||
   Object.values(journal.incidents).some(n=>!Number.isSafeInteger(n)||n<0)||!Number.isSafeInteger(restartLimit)||restartLimit<0)throw Error('Invalid planner supervision checkpoint.');
 const state=()=>structuredClone({...mirror.state,...control,...(journal.history.length?{plannerSupervision:journal}:{})});
 const fault=message=>Object.assign(Error(message),{plannerFault:true});
 function rejectPending(error){if(pending){clearTimeout(pending.timer);pending.reject(error);pending=null;}}
 async function retire(error){const old=worker;worker=null;generation=null;rejectPending(error);if(old)await old.terminate();}
 function launch(){
  if(closed)throw Error('Planner is closed.');
  const token=generation=randomUUID();
  const current=worker=new Worker(new URL('./planner-worker.js',import.meta.url),{workerData:{module,kind,options:{...options,state:state()},generation:token}});
  current.on('error',error=>{if(worker===current)rejectPending(fault(error.message));});
  current.on('exit',code=>{if(worker===current)rejectPending(fault(`Planner exited (${code}); game input remains with its owner.`));});
  current.on('message',message=>{
   if(closed||worker!==current||message.generation!==token||message.id!==pending?.id)return;
   const request=pending;pending=null;clearTimeout(request.timer);
   if(message.error){request.reject(Error(message.error));return;}
   timing.calls++;timing.roundTripMs+=performance.now()-request.startedAt;
   timing.computeMs+=Math.max(0,message.timing?.computeMs??0);timing.snapshotMs+=Math.max(0,message.timing?.snapshotMs??0);
   mirror=message.snapshot;request.resolve(message.result);
  });
 }
 function request(method,args){
  if(!worker)launch();
  return new Promise((resolve,reject)=>{
   const id=++sequence,timer=setTimeout(()=>rejectPending(fault('Planner exceeded its response deadline; game input has been stopped.')),timeoutMs);
   pending={id,method,resolve,reject,timer,startedAt:performance.now()};
   try{worker.postMessage({generation,id,method,args});}catch(error){rejectPending(fault(error.message));}
  });
 }
 const cancelled=()=>({kind:'resample',reason:control?.reason??'Planner input cancelled by user control.',action:{buttons:[],holdFrames:1,releaseFrames:0}});
 async function run(method,args,startedEpoch){
  if(closed)throw Error('Planner is closed.');
  if(method==='decide'&&startedEpoch!==epoch)return cancelled();
  if(method==='resume'&&startedEpoch===epoch)control=null;
  const key=JSON.stringify([method,mirror.state.objective?.id??null,mirror.state.task?.id??null]);
  for(;;){
   try{
    const result=await request(method,args);
    // Some owner commands resume internally after validating a dependency or
    // native receipt. Release only the wait they acknowledged, never a newer
    // user pause, and never clear control when the command rejects.
    if(resumes.has(method)&&startedEpoch===epoch)control=null;
    return method==='decide'&&startedEpoch!==epoch?cancelled():result;
   }catch(error){
    if(!error.plannerFault)throw error;
    await retire(error);
    if(closed)throw error;
    if(method==='decide'&&startedEpoch!==epoch)return cancelled();
    const attempts=journal.incidents[key]??0;
    if(attempts>=restartLimit){
     journal.history.push({key,method,status:'exhausted',attempt:attempts,reason:error.message,at:new Date().toISOString()});journal.history=journal.history.slice(-100);
     throw error;
    }
    journal.incidents[key]=attempts+1;
    journal.history.push({key,method,status:'restarted',attempt:attempts+1,reason:error.message,at:new Date().toISOString()});journal.history=journal.history.slice(-100);
   }
  }
 }
 function call(method,...args){
  const startedEpoch=epoch;busy++;
  const result=tail.then(()=>run(method,args,startedEpoch)).finally(()=>{busy--;});
  tail=result.catch(()=>{});return result;
 }
 function background(method,...args){void call(method,...args).catch(()=>{});}
 function suspend(status,reason){
  epoch++;control={status,reason};
  if(pending?.method==='decide')rejectPending(fault('Planner decision cancelled by user control.'));
  background(status==='paused'?'pause':'wait',reason);
 }
 return {
  record:options.record,state,storyWatch:()=>structuredClone(mirror.storyWatch),campaignStatus:()=>structuredClone(mirror.campaignStatus),
  metrics:()=>({...timing,restarts:Object.values(journal.incidents).reduce((a,b)=>a+b,0)}),
  benchmarkState(){
   const {status,reason,hasStarted,objective,task,supervision,completion}=mirror.state;
   const t=mirror.state.player?.campaignPlanner?.commitments?.training;
   const training=t?Object.fromEntries(['id','forObjective','target','trainingSpecies','trainingPartySlot','trainingMethod','trainingMode','trainingRate']
    .filter(key=>t[key]!==undefined).map(key=>[key,t[key]])):null;
   return structuredClone({status,reason,hasStarted,objective,task,supervision,completion,training});
  },
  storyProgress(observation){
   if(!busy&&observation?.phase==='stable'&&observation.frame!==storyFrame){storyFrame=observation.frame;background('storyProgress',observation);}
   return structuredClone(mirror.storyProgress??null);
  },
  decide:o=>call('decide',o),observeExecution:o=>call('observeExecution',o),acknowledgeCapture:f=>call('acknowledgeCapture',f),
  command:(method,...args)=>call(method,...args),
  pause(reason='Paused by you.'){if(mirror.state.status!=='complete')suspend('paused',reason);},
  wait(reason){suspend(kind==='postgame'?'waiting':'blocked',reason);},
  resume:options=>call('resume',options),ready:()=>call('snapshot'),
  async close(){closed=true;epoch++;await retire(Error('Planner is closed.'));},
 };
}
