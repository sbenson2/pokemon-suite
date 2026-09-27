import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {selectOwnedBreeding} from '../engine/firered/src/suite/native-acquisition.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint as fingerprint} from '../engine/firered/src/player/encounter-tracker.js';

export async function replayNativeAcquisition({session,inputs,fixture,createSession}){
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state});
 let controller=open();
 const observer=createFireRedObserver({session,...inputs,runId:'native-acquisition',storyWatch:controller.storyWatch()});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 const before=capture(),kind=fixture.acquisitionKind;
 const choice=kind==='breeding'?selectOwnedBreeding({trainer:before.playerMemory.trainer,mechanics:inputs.battle}):{speciesId:137};
 assert.ok(choice,'this checkpoint must contain legitimate compatible spare parents');
 controller.beginAcquisition({kind,requestId:'native-'+kind,...choice});
 const originalParents=choice.parents??[],restarted=new Set();let last='',paidSlots=false;
 for(let n=0;n<70000;n++){
  const o=capture(),d=controller.decide(o),state=controller.state(),a=state.acquisition,m=o.playerMemory;
  const trace=JSON.stringify([a?.phase,d.kind,d.reason,d.winner?.recommendation?.kind,state.objective?.id,m.map.id,m.postgameEvidence?.acquisition?.coins,m.postgameEvidence?.acquisition?.slots?.task,m.ui?.party?.stage,m.postgameEvidence?.acquisition?.daycare?.parents.map(p=>p.species),m.gameStats?.savedGame]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# acquisition '+o.frame+' '+trace);last=trace;}
  if(m.postgameEvidence?.acquisition?.slots?.bet===1)paidSlots=true;
  const points=[a?.purchase?'coin-purchase':null,m.ui?.party?.menuType===6?'deposit-menu':null,a?.egg&&a?.parentsReturned?.length===1?'withdrawal':null,a?.saving?'native-save':null].filter(Boolean);
  for(const point of points)if(!restarted.has(point)){controller=open(JSON.parse(JSON.stringify(state)));restarted.add(point);}
  assert.notEqual(d.kind,'blocked',d.reason);
  if(d.kind==='acquisition-saved'){
   assert.equal(d.receipt.nativeSaveVerified,true);
   if(kind==='game-corner'){assert.ok(paidSlots,'the 9999 cap must be resolved through actual paid slots');assert.equal(d.receipt.coinsSpent,9999);assert.ok(restarted.has('coin-purchase'));}
   else{assert.ok(restarted.has('deposit-menu'));assert.ok(restarted.has('withdrawal'));assert.equal(a.parentsReturned.length,2);assert.ok(a.feesPaid>=200);assert.equal(d.receipt.pokemon.isEgg,false);assert.deepEqual(m.trainer.party.map(fingerprint).sort(),before.playerMemory.trainer.party.map(fingerprint).sort());}
   assert.ok(restarted.has('native-save'));
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const coldObserver=createFireRedObserver({session:cold,...inputs,runId:'native-acquisition-cold-proof',storyWatch:controller.storyWatch()});
    const loaded=await continueNativeSaveAsync(cold,coldObserver),all=[...loaded.playerMemory.trainer.party,...loaded.playerMemory.trainer.storage.pokemon];
    assert.equal(all.filter(p=>fingerprint(p)===d.receipt.fingerprint&&!p.isEgg).length,1);
    assert.ok(loaded.playerMemory.trainer.pokedex.ownedSpecies.includes(d.receipt.pokemon.species));
    for(const parent of originalParents)assert.equal(all.filter(p=>fingerprint(p)===fingerprint(parent)&&p.heldItem===parent.heldItem).length,1);
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
