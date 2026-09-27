import {createHash} from './crypto.js';
import {encodeCheckpoint,decodeCheckpoint} from './checkpoint.js';
import {createMgbaSession} from '../../../engine/firered/src/emulator/mgba-session.js';
import {createAutonomousEmulator} from '../../../engine/firered/src/emulator/autonomous-emulator.js';
import {createFireRedObserver} from '../../../engine/firered/src/evidence/fire-red-observer.js';
import {readFireRedRosterFacts} from '../../../engine/firered/src/player/fire-red-roster-facts.js';
import {createFireRedRosterContext} from '../../../engine/firered/src/player/fire-red-roster.js';
import {createCampaignRun,restoreCampaignRun,createCampaignController,presentCampaignRun} from '../../../engine/firered/src/suite/campaign-run.js';

const sha=(algorithm,value)=>createHash(algorithm).update(value).digest('hex');
const STOCK='dd5945db9b930750cb39d00c84da8571feebf417';

export async function createLocalGame({assets,createModule,checkpoint=null,onFrame=()=>{},onAudio=()=>{},onStatus=()=>{},persist=async()=>{}}){
 const {rom,wasm,manifest,inputs}=assets;
 const identity={romSha1:sha('sha1',rom),coreSha256:sha('sha256',wasm)};
 if(identity.romSha1!==STOCK)throw Error('Choose the supported FireRed US revision 1 ROM.');
 if(identity.coreSha256!==manifest.mgba_wasm_sha256)throw Error('The embedded emulator failed its integrity check.');
 const saved=checkpoint?decodeCheckpoint(checkpoint,identity):null;
 const module=await createModule({wasmBinary:wasm,print:()=>{},printErr:message=>console.error(message)});
 const session=createMgbaSession(module,identity).boot(rom);
 let emulator,observer,campaign=null,record=null,observation=null,decision=null,mode='paused',error=null,
  generation=0,task=Promise.resolve(),decisions=saved?.decisions??0,lastPublish=0,lastSave=Date.now(),closed=false;
 const facts=readFireRedRosterFacts({romBytes:rom,cartridge:{id:'firered-rev1-stock',sha1:STOCK,bytes:rom.length},runtime:inputs.runtime,mechanics:inputs.battle});
 const rosterContext=createFireRedRosterContext({...inputs,mechanics:inputs.battle,facts});
 if(saved){
  if(saved.sram.length)session.loadSram(saved.sram);
  session.loadState(saved.state);
  if(saved.campaign){record=restoreCampaignRun(saved.campaign.record,rosterContext);
   campaign=createCampaignController({record,...inputs,mechanics:inputs.battle,state:saved.campaign.state});campaign.pause();}
 }
 function renewObserver(){observer=createFireRedObserver({session,...inputs,runId:record?.id??'mobile-manual',storyWatch:campaign?.storyWatch()});}
 renewObserver();
 function status(){return {schema:'pokemon-suite/mobile-status/v1',mode,error,frame:session.frame,decisions,
  game:'firered',local:true,decision:decision?.reason??null,phase:observation?.emulator?.mode??'boot',
  map:observation?.playerMemory?.map?.id??null,trainer:observation?.playerMemory?.trainer??null,
  campaign:record?presentCampaignRun(record,campaign?.state()):null,
  trade:{ready:false,reason:'Direct Switch radio support is not yet qualified on this device.'}};}
 function publish(force=false){if(force||Date.now()-lastPublish>=500){lastPublish=Date.now();onStatus(status());}}
 function save(){return encodeCheckpoint({identity,state:session.saveState(),sram:session.saveSram(),
  campaign:record?{record,state:campaign?.state()??null}:null,decisions,frame:session.frame});}
 async function checkpointNow(){const value=save();await persist(value);lastSave=Date.now();return value;}
 function makeEmulator(control='bot',paused=true){
  emulator?.close();
  emulator=createAutonomousEmulator({session,emulationSpeed:1,frameExact:true,startPaused:paused,
   controllerState:()=>observer.captureControllerState()});
  emulator.subscribe(onFrame);
  if(control==='manual')emulator.setControlMode('manual');
 }
 makeEmulator();session.subscribeAudio(pcm=>onAudio(pcm,session.audioFormat));
 async function pause(){
  generation++;mode='paused';emulator.pause('Paused on device.');campaign?.pause();
  await task;const value=await checkpointNow();publish(true);return value;
 }
 async function run(lease){
  try{
   while(mode==='bot'&&generation===lease){
    observation=observer.capture();decision=campaign.decide(observation);
    if(decision.kind==='capture-saved'){campaign.acknowledgeCapture(decision.capture.fingerprint);await checkpointNow();continue;}
    if(decision.kind==='campaign-complete'||decision.kind==='blocked'){
     mode=decision.kind==='blocked'?'blocked':'complete';error=decision.reason??null;
     emulator.pause(error??'Campaign complete.');await checkpointNow();publish(true);break;
    }
    const execution=await emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0});
    if(generation!==lease||mode!=='bot')break;
    campaign.observeExecution({observation,decision,execution});decisions++;publish();
    if(Date.now()-lastSave>10000)await checkpointNow();
    await new Promise(resolve=>setTimeout(resolve,0));
   }
  }catch(reason){
   error=reason.message;mode='blocked';campaign?.wait(error);emulator.pause(error);
   try{await checkpointNow();}catch(saveError){error+=' Save failed: '+saveError.message;}
   publish(true);
  }
 }
 return {
  status,
  prepareCampaign(settings={}){
   if(closed||mode!=='paused'||campaign||saved)throw Error('This game already has a save. Create another local adventure to keep it.');
   record=createCampaignRun({settings,rosterContext,romSha1:STOCK});publish(true);return presentCampaignRun(record);
  },
  async startCampaign(){
   if(closed||!record)throw Error('Review an adventure before starting the bot.');
   if(mode==='bot')return status();
   await pause();
   if(!campaign)campaign=createCampaignController({record,...inputs,mechanics:inputs.battle});
   if(campaign.state().status==='complete')throw Error('This adventure is complete.');
   campaign.resume();renewObserver();makeEmulator('bot',false);mode='bot';error=null;
   const lease=++generation;await checkpointNow();task=run(lease);publish(true);return status();
  },
  async manual(){await pause();renewObserver();makeEmulator('manual',false);mode='manual';publish(true);return status();},
  buttons(buttons){if(mode!=='manual')throw Error('Choose Manual play before using the controller.');emulator.setManualButtons(buttons);},
  pause,
  checkpoint:checkpointNow,
  async close(){if(closed)return;await pause();closed=true;emulator.close();session.close();},
 };
}
