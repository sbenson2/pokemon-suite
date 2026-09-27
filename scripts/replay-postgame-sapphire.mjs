import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';

export async function replayPostgameSapphire({session,saved,inputs,createSession}){
 const original=structuredClone(saved.metadata.postgame),campaign=structuredClone(saved.metadata.campaign.record);
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state});let controller=open(original);
 const observer=createFireRedObserver({session,...inputs,runId:'sapphire-return',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture(),identity=p=>JSON.stringify([p.personality,p.otId,...Object.values(p.ivs)]);
 const all=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid');
 const individuals=all(before).map(identity).sort(),stages=new Set();let idle=0,last='';
 assert.equal(before.playerMemory.map.id,'MAP_FIVE_ISLAND_POKEMON_CENTER_1F');
 assert.equal(before.playerMemory.storyState.flagIds[726],true);
 assert.equal(before.playerMemory.storyState.flagIds[725],true);
 assert.equal(before.playerMemory.storyState.flagIds[732],false);
 assert.equal(before.playerMemory.storyState.flagIds[2116],false);
 assert.equal(before.playerMemory.storyState.flagIds[724],false);
 for(let i=0;i<20000;i++){
  const after=capture(),m=after.playerMemory,d=controller.decide(after),state=controller.state();
  assert.notEqual(d.kind,'blocked',d.reason);assert.deepEqual(saved.metadata.campaign.record,campaign);
  if(m.trainer.partyValidity==='valid'&&m.trainer.storage?.validity==='valid')
   for(const individual of individuals)assert.ok(all(after).some(p=>identity(p)===individual),'all original party/PC individuals remain owned');
  if(d.winner?.recommendation?.kind==='wait-for-supported-objective')idle++;else idle=0;
  assert.ok(idle<20,'the warehouse return and Celio delivery must have executable navigation');
  const stage=m.map.id==='MAP_FIVE_ISLAND_MEADOW'?'meadow':
   m.map.id==='MAP_FIVE_ISLAND_ROCKET_WAREHOUSE'&&after.emulator.inBattle?'gideon-battle':
   m.map.id==='MAP_FIVE_ISLAND_ROCKET_WAREHOUSE'&&m.storyState.flagIds[732]===true?'recovered-sapphire':
   m.map.id==='MAP_FIVE_ISLAND_ROCKET_WAREHOUSE'?'warehouse':
   m.map.id==='MAP_FOUR_ISLAND_LORELEIS_HOUSE'&&m.storyState.flagIds[724]===true?'lorelei-conversation':
   m.map.id==='MAP_ONE_ISLAND_POKEMON_CENTER_1F'&&m.storyState.flagIds[2116]===true&&m.ui?.saveDialog?'link-save':
   m.map.id==='MAP_ONE_ISLAND_POKEMON_CENTER_1F'&&m.ui?.fieldDialog?'celio-dialogue':null;
  if(stage&&!stages.has(stage)){stages.add(stage);controller=open(JSON.parse(JSON.stringify(state)));}
  const trace=JSON.stringify([m.map.id,m.position,state.objective?.id,d.kind,d.reason,d.winner?.recommendation?.kind,stage]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# sapphire '+after.frame+' '+trace);last=trace;}
  if(m.storyState.flagIds[2116]===true&&state.preparation?.nativeLinkSave&&after.phase==='stable'&&!Object.values(m.ui??{}).some(Boolean)&&!after.emulator.inBattle){
   for(const stage of ['meadow','warehouse','gideon-battle','recovered-sapphire','lorelei-conversation','celio-dialogue','link-save'])assert.ok(stages.has(stage),stage);
   assert.equal(m.storyState.flagIds[724],true,'the missable conversation must precede Celio delivery');
   assert.ok(m.gameStats.savedGame>before.playerMemory.gameStats.savedGame);
   const cold=await createSession();
   try{cold.loadSram(session.saveSram());const watch=createFireRedObserver({session:cold,...inputs,runId:'sapphire-save',storyWatch:controller.storyWatch()});const loaded=await continueNativeSaveAsync(cold,watch);assert.equal(loaded.playerMemory.storyState.flagIds[2116],true);assert.equal(loaded.playerMemory.storyState.flagIds[724],true);for(const id of individuals)assert.ok(all(loaded).some(p=>identity(p)===id));}finally{cold.close();}
   controller.requestHandoff();if(controller.decide(after).kind==='handoff')return {before,after};
  }
  if(d.kind==='capture-saved')controller.acknowledgeCapture();
  const action=d.action??{buttons:[],holdFrames:8};for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
 }
 throw Error('Sapphire recovery did not complete Gideon, Celio delivery, native save and safe handoff.');
}
