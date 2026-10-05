import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {selectOwnedBreeding} from '../engine/firered/src/suite/native-acquisition.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint as fingerprint} from '../engine/firered/src/player/encounter-tracker.js';

export async function replayNativeAcquisition({session,saved,inputs,fixture,createSession}){
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state});
 const retained=fixture.acquisitionKind==='npc-trade',checkpoint=retained?structuredClone(saved.metadata.session.postgame):null;
 let controller=open(checkpoint);
 const observer=createFireRedObserver({session,...inputs,runId:'native-acquisition',storyWatch:controller.storyWatch()});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 const before=capture(),kind=fixture.acquisitionKind;
 const npcLetterCount=memory=>(memory?.mail?.slots??[]).slice(6).filter(entry=>entry.itemId===131&&entry.species===124).length;
 const initialNpcLetters=npcLetterCount(before.playerMemory);
 assert.ok(['game-corner','breeding','npc-trade'].includes(kind),'unknown native acquisition replay');
 let originalParents=[],sourceId=null,originalParty=[];
 if(retained){
  const a=checkpoint?.acquisition,all=[...before.playerMemory.trainer.party,...before.playerMemory.trainer.storage.pokemon];
  assert.equal(checkpoint.status,'waiting');assert.equal(a?.kind,'npc-trade');assert.equal(a.tradeKey,'zynx');
  assert.equal(before.emulator.mode,'start-menu');assert.equal(before.playerMemory.map.id,'MAP_CELADON_CITY');
  assert.equal(before.playerMemory.ui?.startMenu?.selected,'pokemon');
  assert.equal(before.playerMemory.mail?.slots?.length,16,'the preserved checkpoint must expose the native mailbox');
  assert.ok(before.playerMemory.mail.slots.slice(6).some(entry=>entry.itemId===0),'the received NPC letter needs verified PC mailbox space');
  sourceId=fingerprint(a.source);originalParty=[...a.originalParty];
  assert.equal(all.filter(p=>fingerprint(p)===sourceId).length,1,'the reserved Poliwhirl must have one owner');
  assert.ok(before.playerMemory.trainer.party.some(p=>fingerprint(p)===sourceId),'the trade source must already be in the party');
  controller.resume();
 }else{
  const choice=kind==='breeding'?selectOwnedBreeding({trainer:before.playerMemory.trainer,mechanics:inputs.battle}):{speciesId:137};
  assert.ok(choice,'this checkpoint must contain legitimate compatible spare parents');
  controller.beginAcquisition({kind,requestId:'native-'+kind,...choice});originalParents=choice.parents??[];
 }
 const restarted=new Set(),stages=new Set(retained?['start-menu']:[]);let last='',paidSlots=false;
 for(let n=0;n<70000;n++){
  const o=capture(),d=controller.decide(o),state=controller.state(),a=state.acquisition,m=o.playerMemory;
  const trace=JSON.stringify([a?.phase,d.kind,d.reason,d.winner?.recommendation?.kind,state.objective?.id,m.map.id,m.postgameEvidence?.acquisition?.coins,m.postgameEvidence?.acquisition?.slots?.task,m.ui?.party?.stage,m.postgameEvidence?.acquisition?.daycare?.parents.map(p=>p.species),m.gameStats?.savedGame]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# acquisition '+o.frame+' '+trace);last=trace;}
  if(retained&&n===0){assert.equal(d.kind,'act');assert.deepEqual(d.action?.buttons,['a']);assert.equal(d.winner?.recommendation?.kind,'choose-start-menu-item');assert.equal(d.winner.recommendation.targetItem,'pokemon');assert.equal(d.winner.recommendation.objective,'fly-to-MAPSEC_CERULEAN_CITY');assert.equal(state.objective?.target?.map,'MAP_CERULEAN_CITY_HOUSE3');}
  if(m.ui?.flyMap?.stage==='selection')stages.add('fly-map');
  if(m.map.id==='MAP_CERULEAN_CITY_HOUSE3')stages.add('trade-house');
  if(o.emulator.mode==='in-game-trade'||m.ui?.inGameTrade)stages.add('native-trade');
  if(npcLetterCount(m)===initialNpcLetters+1)stages.add('received-mail-stored');
  if(a?.preparationGoal?.id?.endsWith('-restore-team'))stages.add('restore-team');
  if(retained&&m.trainer.partyValidity==='valid'&&m.trainer.storage?.validity==='valid'){
   const count=[...m.trainer.party,...m.trainer.storage.pokemon].filter(p=>fingerprint(p)===sourceId).length;
   if(!stages.has('native-trade')&&m.storyState?.flagIds?.[0x24A]===false)assert.equal(count,1,'the reserved Poliwhirl must remain singly owned until the native trade');
   if(a?.received)assert.equal(count,0,'the native trader must own the sent Poliwhirl');
  }
  if(m.postgameEvidence?.acquisition?.slots?.bet===1)paidSlots=true;
  const points=[a?.purchase?'coin-purchase':null,m.ui?.party?.menuType===6?'deposit-menu':null,a?.egg&&a?.parentsReturned?.length===1?'withdrawal':null,a?.saving?'native-save':null].filter(Boolean);
  for(const point of points)if(!restarted.has(point)){controller=open(JSON.parse(JSON.stringify(state)));restarted.add(point);}
  assert.notEqual(d.kind,'blocked',d.reason);
  if(d.kind==='acquisition-saved'){
   assert.equal(d.receipt.nativeSaveVerified,true);
   if(kind==='game-corner'){assert.ok(paidSlots,'the 9999 cap must be resolved through actual paid slots');assert.equal(d.receipt.coinsSpent,9999);assert.ok(restarted.has('coin-purchase'));}
   else if(kind==='breeding'){assert.ok(restarted.has('deposit-menu'));assert.ok(restarted.has('withdrawal'));assert.equal(a.parentsReturned.length,2);assert.ok(a.feesPaid>=200);assert.equal(d.receipt.pokemon.isEgg,false);assert.deepEqual(m.trainer.party.map(fingerprint).sort(),before.playerMemory.trainer.party.map(fingerprint).sort());}
   else{
    const all=[...m.trainer.party,...m.trainer.storage.pokemon];
    assert.deepEqual([...stages].sort(),['fly-map','native-trade','received-mail-stored','restore-team','start-menu','trade-house']);
    assert.equal(d.receipt.trade,'zynx');assert.equal(d.receipt.sent.species,61);assert.equal(d.receipt.sent.fingerprint,sourceId);
    assert.equal(d.receipt.pokemon.species,124);assert.equal(d.receipt.pokemon.heldItem,0,'Jynx no longer holds the preserved letter');assert.equal(m.storyState.flagIds[0x24A],true);
    assert.equal(npcLetterCount(m),initialNpcLetters+1,'the received Jynx letter is stored in the PC mailbox before saving');
    assert.equal(all.filter(p=>fingerprint(p)===sourceId).length,0);assert.equal(all.filter(p=>fingerprint(p)===d.receipt.fingerprint).length,1);
    assert.deepEqual(m.trainer.party.map(fingerprint).sort(),[...originalParty].sort(),'the original team must be restored before the save');
   }
   assert.ok(restarted.has('native-save'));
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const coldObserver=createFireRedObserver({session:cold,...inputs,runId:'native-acquisition-cold-proof',storyWatch:controller.storyWatch()});
    const loaded=await continueNativeSaveAsync(cold,coldObserver),all=[...loaded.playerMemory.trainer.party,...loaded.playerMemory.trainer.storage.pokemon];
    assert.equal(all.filter(p=>fingerprint(p)===d.receipt.fingerprint&&!p.isEgg).length,1);
    assert.ok(loaded.playerMemory.trainer.pokedex.ownedSpecies.includes(d.receipt.pokemon.species));
    for(const parent of originalParents)assert.equal(all.filter(p=>fingerprint(p)===fingerprint(parent)&&p.heldItem===parent.heldItem).length,1);
    if(retained){assert.equal(all.filter(p=>fingerprint(p)===sourceId).length,0);assert.equal(loaded.playerMemory.storyState.flagIds[0x24A],true);assert.deepEqual(loaded.playerMemory.trainer.party.map(fingerprint).sort(),[...originalParty].sort());assert.equal(npcLetterCount(loaded.playerMemory),initialNpcLetters+1,'cold Continue preserves the received NPC letter in the PC mailbox');}
   }finally{cold.close();}
   controller.acknowledgeAcquisition();assert.equal(controller.state().acquisition,null);assert.equal(controller.canYield(o),true);
   return {before,after:o};
  }
  if(d.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
  const action=d.action??{buttons:[],holdFrames:8};
  for(let i=0;i<(action.holdFrames??1);i++)session.step(action.buttons??[]);
  for(let i=0;i<(action.releaseFrames??0);i++)session.step([]);
 }
 throw Error('The native acquisition did not finish its save and return ownership.');
}
