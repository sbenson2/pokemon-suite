// The planner never owns an emulator, frame clock, input lease, or save file.
import {parentPort,workerData} from 'node:worker_threads';
const module=await import(workerData.module);
const planner=workerData.kind==='postgame'?module.createPostgameController(workerData.options):module.createCampaignController(workerData.options);
const allowed=new Set(['decide','observeExecution','pause','resume','wait','acknowledgeCapture','snapshot','storyProgress']);
if(workerData.kind==='postgame')for(const name of ['setPartnerAvailability','setLeagueTraining','beginAdventure','rejectHunt','beginAcquisition','acknowledgeAcquisition','beginPlayerTask','beginQmmSupply','preserveEvolutionSource','beginEvolution','prepareAcquisition','resumeVerifiedCapture','requestHandoff','acknowledgeEvolution','acceptEvolutionRoundTrip','acknowledgeDexEvolution','deferPartnerEvolution','recordHunt','completeHunt','setExtraSaveSources','acceptExtraSaveTrade','deferExtraSave'])allowed.add(name);// extra-saves: last three
let tail=Promise.resolve();
parentPort.on('message',message=>{
 tail=tail.then(async()=>{
  const {generation,id,method,args}=message;
  if(generation!==workerData.generation||!allowed.has(method))throw Error('Invalid planner protocol message.');
  try{
   const startedAt=performance.now();
   const result=method==='snapshot'||method==='storyProgress'&&!planner.storyProgress?null:await planner[method](...args);
   const computedAt=performance.now();
   const storyProgress=planner.storyProgress?.(method==='decide'?args[0]:null)??null;
   const snapshot={state:planner.state(),storyWatch:planner.storyWatch(),campaignStatus:planner.campaignStatus?.()??null,storyProgress};
   parentPort.postMessage({generation,id,result,snapshot,timing:{computeMs:computedAt-startedAt,snapshotMs:performance.now()-computedAt}});
  }catch(error){parentPort.postMessage({generation,id,error:error.message});}
 }).catch(error=>{throw error;});
});
