import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {readSafariStatus} from '../engine/firered/src/suite/safari-mission.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';

export async function replayPostgameSafariSave({session,saved,inputs,createSession}) {
 const original=structuredClone(saved.metadata.postgame),campaign=structuredClone(saved.metadata.campaign.record);
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state});let controller=open(original);controller.resume();
 const observer=createFireRedObserver({session,...inputs,runId:'safari-save',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,safari:readSafariStatus(session,inputs.runtime,o.playerMemory.battleTypeFlags),postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture(),source=original.dexEvolution.originalPokemon;
 assert.equal(before.playerMemory.map.id,'MAP_SAFARI_ZONE_CENTER');
 assert.equal(original.dexEvolution.phase,'saving');assert.equal(before.playerMemory.trainer.pokedex.ownedSpecies.length,60);
 const identity=p=>JSON.stringify([p.personality,p.otId,...Object.values(p.ivs)]);
 const all=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid');
 const identities=all(before).map(identity).sort();const evolved=o=>all(o).find(p=>p.personality===source.personality&&p.otId===source.otId);
 assert.equal(evolved(before).species,45);
 const stages=new Set();let last='',savedEvolution=false,idle=0,stocking=false;
 for(let i=0;i<6000;i++){
  const after=capture(),m=after.playerMemory,d=controller.decide(after),state=controller.state();
  assert.notEqual(d.kind,'blocked',d.reason);assert.deepEqual(saved.metadata.campaign.record,campaign);
  if(m.trainer.partyValidity==='valid'&&m.trainer.storage?.validity==='valid'){
   assert.equal(evolved(after)?.species,45);assert.deepEqual(evolved(after).ivs,source.ivs);
   assert.deepEqual(all(after).map(identity).sort(),identities,'retirement preserves all party and PC individuals');
  }else assert.equal(d.kind,'resample','a transient native party reorder cannot authorize input or establish a missing individual');
  const stage=!savedEvolution&&m.ui?.choiceMenu?'retire-confirm':
    !savedEvolution&&m.ui?.saveDialog?.stage==='success'?'saved-dialog':
    savedEvolution&&m.ui?.mart?.stage==='purchase-result'?'stocking-result':
    savedEvolution&&m.ui?.flyMap?.stage==='selection'?'fly-menu':
    savedEvolution&&m.map.id==='MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB'&&m.ui?.fieldDialog?'oak-dialog':null;
  if(stage&&!stages.has(stage)){stages.add(stage);controller=open(JSON.parse(JSON.stringify(state)));}
  const trace=JSON.stringify([m.map.id,d.kind,d.winner?.recommendation,m.ui?.saveDialog?.stage]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&last!==trace){console.log('# safari-save '+after.frame+' '+trace);last=trace;}
  if(m.map.id.startsWith('MAP_SAFARI_ZONE_'))assert.equal(m.gameStats.savedGame,before.playerMemory.gameStats.savedGame,'never pretend the unsaved evolution is already durable');
  if(d.winner?.recommendation?.kind==='wait-for-supported-objective')idle++;else idle=0;
  assert.ok(idle<20,'the saved evolution must hand off to executable travel, not repeated unsupported waits');
  if(d.kind==='dex-evolution-saved'){
   assert.ok(stages.has('retire-confirm')&&stages.has('saved-dialog'));
   assert.equal(m.map.id,'MAP_FUCHSIA_CITY_SAFARI_ZONE_ENTRANCE');
   assert.equal(m.gameStats.savedGame,before.playerMemory.gameStats.savedGame+1);
   assert.equal(d.receipt.nativeSaveVerified,true);assert.equal(d.receipt.nativeSaveAfterEvolution,true);
   assert.equal(d.receipt.pokemon.species,45);assert.equal(d.receipt.pokemon.personality,source.personality);
   const cold=await createSession();
   try{cold.loadSram(session.saveSram());const watch=createFireRedObserver({session:cold,...inputs,runId:'safari-save-cold',storyWatch:controller.storyWatch()});const loaded=await continueNativeSaveAsync(cold,watch);assert.equal(evolved(loaded)?.species,45);assert.deepEqual(all(loaded).map(identity).sort(),identities);assert.ok(loaded.playerMemory.trainer.pokedex.ownedSpecies.includes(45));}finally{cold.close();}
   controller.acknowledgeDexEvolution();controller=open(JSON.parse(JSON.stringify(controller.state())));const next=controller.decide(after);
   assert.notEqual(next.kind,'blocked');
   const nextId=controller.state().objective?.id;stocking=nextId==='stock-postgame-supplies';
   assert.ok(stocking||nextId==='evolution-unlock-national-dex','only post-League provisioning may precede the Oak handoff');
   savedEvolution=true;continue;
  }
  if(savedEvolution&&m.storyState?.flagIds?.[2112]===true&&state.preparation?.nationalDexSave?.nativeLinkSave&&
     !Object.values(m.ui??{}).some(Boolean)&&after.emulator.mode==='overworld'){
   assert.ok(stages.has('reached-oak'),'travel must reach Professor Oak and complete the National Dex interaction');
   if(stocking){assert.ok(stages.has('stocking-result'),'provision through a restarted native purchase result');assert.ok(state.fieldCare.spent>0&&m.trainer.money>=10000&&m.trainer.money<before.playerMemory.trainer.money);}
   assert.ok(stages.has('fly-menu')&&stages.has('oak-dialog'),'travel and dialogue survive reconstruction');
   const cold=await createSession();
   try{cold.loadSram(session.saveSram());const watch=createFireRedObserver({session:cold,...inputs,runId:'national-dex-cold',storyWatch:controller.storyWatch()});
    const loaded=await continueNativeSaveAsync(cold,watch);
    assert.equal(loaded.playerMemory.storyState.flagIds[2112],true,'the National Dex upgrade is durable');
    assert.deepEqual(all(loaded).map(identity).sort(),identities);
   }finally{cold.close();}
   controller.requestHandoff();const handoff=controller.decide(after);
   if(handoff.kind==='handoff')return {before,after};
  }
  if(savedEvolution&&m.map.id==='MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB')stages.add('reached-oak');
  const action=d.action??{buttons:[],holdFrames:8};for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
 }
 throw Error('The retained Safari evolution did not retire, save and hand off to Oak.');
}
