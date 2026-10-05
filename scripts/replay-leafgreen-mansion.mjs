import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';

// LeafGreen Pokémon Mansion (build 126). The live LeafGreen campaign stopped
// with no-meaningful-progress on Mansion 2F (9,3): after the 3F statue set the
// Mansion switch, a heal trip walked down the 3F stairs into the 2F pocket the
// switch-set barrier seals, because the offscreen graph still used the
// switch-reset floors. From that preserved save the owner's reviewed retry must
// climb back to 3F, drop through a hole, heal at Cinnabar, then obtain the
// Secret Key and leave the Mansion, also after a controller restart. Only
// controller inputs are used.
const CENTER='MAP_CINNABAR_ISLAND_POKEMON_CENTER_1F';
export async function replayLeafGreenMansion({session,saved,inputs,createSession}){
 assert.equal(saved.identity.game,'leafgreen','a LeafGreen checkpoint');
 const original=saved.metadata.campaign;
 assert.equal(original.state.status,'blocked');assert.equal(original.state.reason,'no-meaningful-progress');
 assert.equal(original.state.task?.objective?.id,'recover-training-party','the heal trip was the stopped task');
 // The supervisor accounts active time; advance it at the stopped run's own
 // measured rate (its elapsed milliseconds per emulated frame).
 const msPerFrame=original.state.supervision.elapsedMs/saved.metadata.frame;
 let campaignNow=0;
 const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state,clock:()=>campaignNow});
 let controller=open(JSON.parse(JSON.stringify(original.state)));controller.resume({retryBlockedPolicy:true});
 const observer=createFireRedObserver({session,...inputs,runId:'leafgreen-mansion',storyWatch:controller.storyWatch()});
 observer.capture();const before=observer.capture(),start=before.playerMemory;
 assert.deepEqual([start.map.id,start.position.x,start.position.y],['MAP_POKEMON_MANSION_2F',9,3]);
 assert.equal(start.storyState.flagIds[620],true,'the Mansion switch is set');
 assert.equal(start.storyState.flagIds[424],false,'the Secret Key is not obtained yet');
 const route=[start.map.id],healthy=m=>m.trainer.party.every(p=>p.hp===p.maxHp&&!p.status);
 let after=before,healed=false,restarted=false,key=false,last='';
 let now=0,id=0;const jobs=new Map();
 const emulator=createAutonomousEmulator({session,emulationSpeed:10,frameExact:true,videoFramesPerSecond:1,
  clock:()=>now,schedule(callback,delay){const k=++id;jobs.set(k,{callback,at:now+delay});return k;},cancel:k=>jobs.delete(k),
  actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState()});
 try{for(let step=0;step<60000;step++){
  after=observer.capture();campaignNow=(after.frame-before.frame)*msPerFrame;
  const m=after.playerMemory;
  if(after.phase==='stable'&&m.map.id!==route.at(-1))route.push(m.map.id);
  if(!healed&&route.includes(CENTER)&&healthy(m)&&controller.state().task?.kind!=='recovery')healed=true;
  // Restart once in the field after the heal, from the serialized state.
  if(healed&&!restarted&&after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&m.map.id!==CENTER){
   controller=open(JSON.parse(JSON.stringify(controller.state())));restarted=true;
  }
  key||=m.storyState.flagIds[424]===true;
  if(key&&after.phase==='stable'&&m.map.id==='MAP_CINNABAR_ISLAND'){
   const pocket=route.indexOf('MAP_POKEMON_MANSION_3F'),fall=route.indexOf('MAP_POKEMON_MANSION_1F',pocket);
   assert.ok(pocket===1,'the heal trip first climbed back from the pocket to 3F: '+route.join(' > '));
   assert.ok(fall>pocket&&route.indexOf('MAP_CINNABAR_ISLAND')>fall,'then dropped to 1F and left the Mansion: '+route.join(' > '));
   assert.ok(healed&&restarted,'healed at Cinnabar and survived a controller restart');
   assert.equal(controller.state().status,'running');
   const replica=await createSession();try{
    replica.loadSram(session.saveSram());replica.loadState(session.saveState());
    const check=createFireRedObserver({session:replica,...inputs,runId:'leafgreen-mansion-reloaded',storyWatch:controller.storyWatch()});check.capture();
    assert.notEqual(open(JSON.parse(JSON.stringify(controller.state()))).decide(check.capture()).kind,'blocked');
   }finally{replica.close();}
   console.log('# leafgreen-mansion-evidence '+JSON.stringify({startFrame:before.frame,endFrame:after.frame,route,healed,restarted,
    secretKey:key,next:controller.state().objective?.id??null}));
   return {before,after};
  }
  const decision=controller.decide(after),r=decision.winner?.recommendation;
  assert.notEqual(decision.kind,'blocked',`${decision.reason} at ${m.map.id} ${JSON.stringify(m.position)}: ${route.join(' > ')}`);
  assert.deepEqual(controller.record,original.record);
  if(process.env.SUITE_REPLAY_TRACE==='1'){
   const trace=JSON.stringify([m.map.id,m.position,after.emulator.mode,r?.kind,r?.objective,controller.state().task?.kind??null,m.storyState.flagIds[620]]);
   if(trace!==last&&after.phase==='stable'){console.log('# mansion '+step+' '+after.frame+' '+trace);last=trace;}
  }
  let done=false,result,error;emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0}).then(x=>{result=x;done=true;},e=>{error=e;done=true;});
  for(let n=0;n<10000&&!done;n++){
   await Promise.resolve();if(done)break;const [k,job]=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0]??[];assert.ok(job);jobs.delete(k);now=job.at;job.callback();
  }
  assert.ok(done);if(error)throw error;controller.observeExecution({observation:after,decision,execution:result});
 }
 throw Error('The Mansion run did not heal, obtain the Secret Key and leave: '+route.join(' > '));
 }finally{emulator.close();}
}
