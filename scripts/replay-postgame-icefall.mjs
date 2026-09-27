import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';

export async function replayPostgameIcefall({session,saved,inputs,createSession}){
 const original=structuredClone(saved.metadata.postgame),campaign=structuredClone(saved.metadata.campaign.record);
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state});let controller=open(original);
 const observer=createFireRedObserver({session,...inputs,runId:'icefall-handoff',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture(),identity=p=>JSON.stringify([p.personality,p.otId,...Object.values(p.ivs)]);
 const all=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid');
 const individuals=all(before).map(identity).sort(),stages=new Set();let idle=0,last='';
 assert.equal(before.playerMemory.map.id,'MAP_FOUR_ISLAND_POKEMON_CENTER_1F');
 assert.equal(before.playerMemory.storyState.flagIds[142],false);
 assert.ok(before.playerMemory.trainer.party.some(p=>p.species===116&&p.moves.includes(127)));
 for(let i=0;i<20000;i++){
  const after=capture(),m=after.playerMemory,d=controller.decide(after),state=controller.state();
  assert.notEqual(d.kind,'blocked',d.reason);
  assert.deepEqual(saved.metadata.campaign.record,campaign);
  if(m.trainer.partyValidity==='valid'&&m.trainer.storage?.validity==='valid')
   for(const individual of individuals)assert.ok(all(after).some(p=>identity(p)===individual),'all original party/PC individuals remain owned');
  if(d.winner?.recommendation?.kind==='wait-for-supported-objective')idle++;else idle=0;
  assert.ok(idle<20,'the Icefall task and its return must have executable navigation');
  const stage=m.ui?.party?.actions?.includes('waterfall')?'waterfall-menu':
   m.map.id==='MAP_FOUR_ISLAND_ICEFALL_CAVE_ENTRANCE'&&m.position.y<14?'above-waterfall':
   m.map.id==='MAP_FOUR_ISLAND_ICEFALL_CAVE_BACK'&&m.ui?.fieldDialog?'lorelei-dialogue':
   m.map.id==='MAP_FOUR_ISLAND_ICEFALL_CAVE_BACK'&&after.emulator.inBattle?'rocket-battle':null;
  if(stage&&!stages.has(stage)){stages.add(stage);controller=open(JSON.parse(JSON.stringify(state)));}
  const trace=JSON.stringify([m.map.id,m.position,state.objective?.id,d.kind,d.reason,d.winner?.recommendation?.kind,m.ui?.party?.stage]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# icefall '+after.frame+' '+trace);last=trace;}
  if(m.storyState.flagIds[142]===true&&m.map.id==='MAP_FOUR_ISLAND'&&after.phase==='stable'&&!Object.values(m.ui??{}).some(Boolean)&&!after.emulator.inBattle){
   for(const stage of ['waterfall-menu','above-waterfall','lorelei-dialogue','rocket-battle'])assert.ok(stages.has(stage),stage);
   assert.ok(m.gameStats.savedGame>before.playerMemory.gameStats.savedGame);
   const cold=await createSession();
   try{cold.loadSram(session.saveSram());const watch=createFireRedObserver({session:cold,...inputs,runId:'icefall-save',storyWatch:controller.storyWatch()});const loaded=await continueNativeSaveAsync(cold,watch);assert.equal(loaded.playerMemory.storyState.flagIds[142],true);for(const id of individuals)assert.ok(all(loaded).some(p=>identity(p)===id));}finally{cold.close();}
   controller.requestHandoff();if(controller.decide(after).kind==='handoff')return {before,after};
  }
  if(d.kind==='capture-saved')controller.acknowledgeCapture();
  const action=d.action??{buttons:[],holdFrames:8};for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
 }
 throw Error('Icefall did not complete the native Lorelei battle, save and return to Four Island.');
}
