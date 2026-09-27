import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {decodeBoxPokemonRecord} from '../engine/firered/src/evidence/pokemon-record.js';
import {qmmLevel} from '../engine/firered/src/suite/qmm-supply.js';

// Opt-in Rare Candy supply through the question-mark Mail glitch, driven only
// by the real postgame owner (controller.decide) with ordinary button input.
// Fixtures come from the copied live FireRed save (September 22) after the
// prerequisites were played natively: CH'DING Farfetch'd (Knock Off), MIMIEN
// Mr. Mime trained to Recycle, Parasect (Spore), Snorlax holding a Chesto Berry.
// Retries of the setup battle are power cycles to its native save.
const RARE_CANDY=68,RETRO_MAIL=132;
const count=(o,id)=>Object.values(o.playerMemory.trainer.bag??{}).flat().reduce((n,i)=>n+(i?.itemId===id?i.quantity:0),0);
const identities=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid').map(encounterFingerprint).sort();
const holdsMail=o=>o.playerMemory.trainer.party.some(p=>p.heldItem>=121&&p.heldItem<=132);
// Box 3 slot 1 is what the question-mark Mail aliases; supply deposits avoid Box 3.
const box3Slot1=o=>{const p=o.playerMemory.trainer.storage.pokemon.find(p=>p.box===2&&p.slot===0&&p.validity==='valid');return p?encounterFingerprint(p):null;};

// A console whose frame counter keeps running across power cycles, so the
// frame budget and case evidence stay monotonic. (The live worker's counter
// restarts at the power cycle; the setup case also passes that way.)
function consoleOf(core,offset=0){
 let base=offset;
 return new Proxy(core,{get:(t,k)=>k==='frame'?t.frame+base:k==='reset'?()=>{base+=t.frame;t.reset();}:typeof t[k]==='function'?t[k].bind(t):t[k]});
}
async function drive({session,inputs,saved,fixtureId,qmmSupply,until,onObservation=()=>{},restartWhen=()=>false,budget}){
 let clock=0;
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>clock,qmmSupply});
 let controller=open(structuredClone(saved.metadata.session.postgame));
 let observer=createFireRedObserver({session,...inputs,runId:fixtureId,storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const start=session.frame,log={powerCycles:[],restarts:[],decisions:0};let last='';
 for(let n=0;n<400000;n++){
  const o=capture();
  assert.ok(session.frame-start<=budget,`${fixtureId} exceeded its ${budget}-frame budget`);
  onObservation(o,controller.state());
  if(restartWhen(o,controller.state(),log)){
   controller=open(JSON.parse(JSON.stringify(controller.state())));log.restarts.push({frame:o.frame,phase:controller.state().qmm?.phase});continue;
  }
  const decision=controller.decide(o),state=controller.state();log.decisions++;
  const trace=JSON.stringify([decision.kind,decision.reason,o.playerMemory.map?.id,state.qmm?.phase,state.qmm?.progress?.step,decision.winner?.recommendation?.kind,o.phaseReasons.join('+')||undefined,Object.keys(o.playerMemory.ui).filter(k=>o.playerMemory.ui[k]).join('+')||undefined]);
  if(trace!==last){console.log(`# ${fixtureId} ${o.frame} ${trace}`);last=trace;}
  assert.notEqual(decision.kind,'blocked',decision.reason);
  const done=until(o,decision,state,log);
  if(done)return {...done,controller,log,start};
  if(decision.kind==='capture-saved'){controller.acknowledgeCapture();log.captures=(log.captures??0)+1;continue;}
  if(decision.kind==='power-cycle'){
   log.powerCycles.push({frame:o.frame,reason:decision.reason,savedGame:o.playerMemory.gameStats.savedGame,sram:o.sram.sha256});
   session.reset();clock+=1000;
   observer=createFireRedObserver({session,...inputs,runId:`${fixtureId}-after-power-cycle`,storyWatch:controller.storyWatch()});
   continue;
  }
  const action=decision.action??{buttons:[],holdFrames:8};
  for(let i=0;i<(action.holdFrames??1);i++){session.step(action.buttons??[]);clock+=1000/60;}
  for(let i=0;i<(action.releaseFrames??0);i++){session.step([]);clock+=1000/60;}
 }
 throw Error(`${fixtureId}: the Mail supply did not finish.`);
}
async function coldRead(createSession,inputs,sram,runId){
 const cold=await createSession();
 try{
  cold.loadSram(sram);
  const observer=createFireRedObserver({session:cold,...inputs,runId,storyWatch:{flags:[0x24d,0x248,0x500+487],variables:[]}});
  const o=await continueNativeSaveAsync(cold,observer);
  const storage=cold.readMemory(inputs.runtime.data.symbols.gPokemonStoragePtr.address,4);
  const pointer=(storage[0]|(storage[1]<<8)|(storage[2]<<16)|(storage[3]<<24))>>>0;
  const boxes=cold.readMemory(pointer,4+14*30*80),invalid=[];
  for(let slot=0;slot<420;slot++){const r=decodeBoxPokemonRecord(boxes,4+slot*80);if(!['valid','empty'].includes(r.validity))invalid.push({box:Math.floor(slot/30)+1,slot:slot%30+1,reason:r.reason});}
  return {o,invalid};
 }finally{cold.close();}
}
function verifyClean(cold,{label}){
 const t=cold.o.playerMemory.trainer;
 assert.equal(t.partyValidity,'valid',`${label}: party records verify`);
 assert.equal(t.storage.validity,'valid',`${label}: PC storage verifies`);
 assert.deepEqual(cold.invalid,[],`${label}: no Bad Egg or checksum failure in any box slot`);
 assert.equal(cold.o.playerMemory.mail.box3Slot1.empty,true,`${label}: Box 3 slot 1 stays empty`);
 assert.equal(holdsMail(cold.o),false,`${label}: no party Pokémon holds Mail`);
}

export async function replayQmmSetupBattle({session:core,saved,inputs,createSession,fixture}){
 // Attempt 1 gives up at turn 1 (the policy's turn budget), so the owner must
 // recognise the missing reservation and power-cycle to its pre-battle save.
 const session=consoleOf(core);
 const qmmSupply={enabled:true,giveUpTurnByAttempt:[1,10,10]};
 const observer=createFireRedObserver({session,...inputs,runId:'qmm-setup-before'});
 const before=observer.capture(),originals=identities(before);
 assert.deepEqual(before.playerMemory.mail.orphanSlots,[],'the save has no reserved mail slot yet');
 assert.equal(before.playerMemory.trainer.party.find(p=>p.species===122).heldItem,RETRO_MAIL);
 let preBattle=null,attempts=[],titleWaits=[];
 const result=await drive({session,inputs,saved,fixtureId:fixture.id,qmmSupply,budget:120000,
  onObservation:(o,state)=>{
   const setup=state.qmm?.setup;
   if(setup?.preBattleSave&&!preBattle)preBattle=structuredClone(setup.preBattleSave);
   if(setup?.battle&&!attempts.some(a=>a.attempt===setup.battle.attempt))attempts.push({attempt:setup.battle.attempt,startFrame:o.frame});
  },
  until:(o,decision,state)=>{
   if(/title-screen frames/.test(decision.reason??''))titleWaits.push(o.frame);
   return state.qmm?.phase==='session'&&state.qmm.setup.postBattleSave&&o.phase==='stable'?{after:o,state}:null;
  }});
 const {after,state,log}=result;
 const setup=state.qmm.setup;
 assert.equal(log.powerCycles.length,1,'exactly one power-cycle retry');
 assert.ok(titleWaits.length>0&&titleWaits.every(f=>f>log.powerCycles[0].frame),'the retry left the title screen on a later frame (new RNG seed)');
 assert.equal(setup.attempts,2,'the second attempt reserved the slot');
 const failed=state.qmm.receipts.find(r=>r.kind==='setup-battle-failed');
 assert.ok(failed&&failed.attempt===1,'the forced short first attempt is recorded as failed');
 assert.equal(log.powerCycles[0].savedGame,preBattle.counter,'the failed attempt was not saved');
 assert.ok(preBattle.counter>before.playerMemory.gameStats.savedGame,'the owner made its own pre-battle native save');
 const orphans=after.playerMemory.mail.orphanSlots,mime=after.playerMemory.trainer.party.find(p=>p.species===122);
 assert.ok(orphans.length===1,'one party mail slot is reserved');
 assert.equal(mime.heldItem,134,'Mr. Mime recycled the Chesto Berry');
 assert.equal(after.playerMemory.mail.party.find(x=>x.slot===mime.slot).mailId,orphans[0],'Mr. Mime still links the reserved slot');
 assert.equal(holdsMail(after),false);
 assert.equal(setup.postBattleSave.counter,preBattle.counter+1,'the reservation was saved natively');
 assert.equal(after.sram.sha256,setup.postBattleSave.sha256);
 const turns=setup.battle.turns;
 assert.ok(turns.some(t=>t.usedHeldItems?.[0]===134),'the Chesto Berry was consumed at the left position');
 assert.ok(turns.some(t=>(t.knockedOffMons?.[0]??0)!==0),'Knock Off marked the Mail holder');
 const cold=await coldRead(createSession,inputs,core.saveSram(),'qmm-setup-cold');
 verifyClean(cold,{label:'setup'});
 assert.deepEqual(cold.o.playerMemory.mail.orphanSlots,orphans,'cold Continue keeps the reserved slot');
 assert.deepEqual(identities(cold.o),originals,'every individual is preserved');
 console.log('# qmm-setup verified '+JSON.stringify({attempts:setup.attempts,powerCycles:log.powerCycles,titleWaitDecisions:titleWaits.length,orphans,preBattle,postBattle:setup.postBattleSave,
  battleFrames:setup.battle.endFrame-setup.battle.startFrame,totalFrames:after.frame-result.start}));
 return {before,after};
}

async function duplicateCase({session:core,saved,inputs,createSession,fixture},{expectSeedLink,budget}){
 const session=consoleOf(core);
 const observer=createFireRedObserver({session,...inputs,runId:`${fixture.id}-before`});
 const before=observer.capture(),originals=identities(before);
 const originalParty=before.playerMemory.trainer.party.map(p=>({fp:encounterFingerprint(p),held:p.heldItem}));
 assert.ok(before.playerMemory.mail.orphanSlots.length>0,'the save already has a reserved mail slot');
 assert.equal(holdsMail(before),false);
 const request=saved.metadata.session.postgame.playerTask.request,startCandies=count(before,RARE_CANDY);
 let restarted=false,qmmReceipt=null,box3Changes=0;
 const result=await drive({session,inputs,saved,fixtureId:fixture.id,qmmSupply:{enabled:true},budget,
  restartWhen:(o,state)=>!restarted&&state.qmm?.session?.dupes>=2&&(restarted=true),
  // Save blocks relocate during CB2_ReturnToFieldLocal; only stable reads count.
  onObservation:(o,state)=>{if(o.phase==='stable'&&o.playerMemory.mail?.box3Slot1&&!o.playerMemory.mail.box3Slot1.empty){box3Changes++;console.log('# box3 '+JSON.stringify({frame:o.frame,cb2:o.emulator.callback2,head:o.playerMemory.mail.box3Slot1.head}));}},
  until:(o,decision)=>{
   if(decision.qmmReceipt)qmmReceipt=decision.qmmReceipt;
   return decision.kind==='player-task-complete'?{after:o,receipt:decision.receipt}:null;
  }});
 const {after,receipt,log}=result;
 assert.ok(restarted,'the owner was reconstructed from its checkpoint mid-session');
 assert.equal(box3Changes,0,'Box 3 slot 1 stayed empty throughout');
 assert.ok(qmmReceipt?.nativeSaveVerified,'the supply finished with a native save');
 assert.ok(receipt.nativeSaveVerified,'the Rare Candy request saved natively');
 assert.ok(count(after,RARE_CANDY)>=startCandies+request.quantity,'the request quantity was reached');
 assert.equal(holdsMail(after),false,'all Mail was taken back');
 assert.deepEqual(after.playerMemory.trainer.party.map(p=>({fp:encounterFingerprint(p),held:p.heldItem})),originalParty,'party order and held items are restored');
 const iterations=qmmReceipt.iterations;
 assert.equal(iterations.length,qmmReceipt.duplicated);
 for(const it of iterations){
  assert.equal(it.box3Slot1Unchanged,true,'the question-mark Mail screen wrote nothing');
  if(expectSeedLink)assert.notEqual(it.ec?.mailIndex,255,'the orphan’s former holder opens its own record, not Box 3 slot 1');
  else assert.equal(it.ec?.aliasesBox3Slot1,true,'without a link the screen shows the Box 3 slot 1 alias');
 }
 const cold=await coldRead(createSession,inputs,core.saveSram(),`${fixture.id}-cold`);
 verifyClean(cold,{label:fixture.id});
 assert.equal(count(cold.o,RARE_CANDY),count(after,RARE_CANDY),'cold Continue keeps the candies');
 assert.deepEqual(cold.o.playerMemory.mail.orphanSlots,before.playerMemory.mail.orphanSlots,'the reserved slot persists for later supplies');
 assert.deepEqual(identities(cold.o),originals,'every individual is preserved');
 console.log(`# ${fixture.id} verified `+JSON.stringify({candies:[startCandies,count(after,RARE_CANDY)],mail:[count(before,RETRO_MAIL),count(after,RETRO_MAIL)],
  money:[before.playerMemory.trainer.money,after.playerMemory.trainer.money],duplicated:qmmReceipt.duplicated,restarts:log.restarts,
  seedMailIndex:iterations[0]?.ec?.mailIndex,frames:after.frame-result.start,savedSram:after.sram.sha256}));
 return {before,after};
}

export async function replayQmmDuplicate(args){return duplicateCase(args,{expectSeedLink:true,budget:90000});}
export async function replayQmmRenewable(args){return duplicateCase(args,{expectSeedLink:false,budget:120000});}

// From the copied live save: the supply resolves its missing cast through the
// cartridge's own sources (Kindle Road Spearow, Vermilion and Route 2 trades,
// the boxed Abra) and hands the traded Mr. Mime to Recycle training. Training
// itself (≈230k frames from level 9) is covered by the build-98 evolution
// trainer, not replayed here.
export async function replayQmmPrerequisites({session:core,saved,inputs,fixture}){
 const session=consoleOf(core);
 const observer=createFireRedObserver({session,...inputs,runId:`${fixture.id}-before`,storyWatch:{flags:[0x24d,0x248],variables:[]}});
 const before=observer.capture(),originals=identities(before);
 const all=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid');
 assert.equal(before.playerMemory.storyState.flagIds[0x24d],false);assert.equal(before.playerMemory.storyState.flagIds[0x248],false);
 assert.ok(!all(before).some(p=>p.moves.includes(282)||p.moves.includes(278)),'no Knock Off or Recycle user yet');
 const abra=all(before).find(p=>p.species===63);
 const steps=new Set();
 const result=await drive({session,inputs,saved,fixtureId:fixture.id,qmmSupply:{enabled:true},budget:120000,
  onObservation:(o,state)=>{if(state.qmm?.progress?.step)steps.add(state.qmm.progress.step);},
  // Stop once the owner hands Mr. Mime to training and the trade script has closed.
  until:(o,decision,state)=>String(state.objective?.id??'').endsWith('train-recycle')&&o.phase==='stable'&&o.emulator.mode==='overworld'&&
   !Object.values(o.playerMemory.ui).some(Boolean)&&o.playerMemory.storyState.flagIds[0x248]===true?{after:o,state}:null});
 const {after,state}=result;
 assert.equal(state.qmm.phase,'prerequisites');
 assert.equal(after.playerMemory.storyState.flagIds[0x24d],true,'the Vermilion Farfetch\'d trade was completed');
 assert.equal(after.playerMemory.storyState.flagIds[0x248],true,'the Route 2 Mr. Mime trade was completed');
 const farfetchd=all(after).find(p=>p.species===83),mime=after.playerMemory.trainer.party.find(p=>p.species===122);
 assert.ok(farfetchd?.moves.includes(282),'the traded Farfetch\'d knows Knock Off at once');
 assert.ok(mime&&mime.level===qmmLevel(abra,inputs.battle),'Mr. Mime arrives at the traded Abra\'s level');
 assert.equal(state.objective.minimumCoreLevel,33);assert.deepEqual(state.objective.learnMoveIds,[278]);
 assert.equal(holdsMail(after),false);
 assert.equal(box3Slot1(after),box3Slot1(before),'Box 3 slot 1 keeps its occupant: supply deposits avoid Box 3');
 const kept=identities(after);
 const lost=originals.filter(f=>!kept.includes(f));
 assert.deepEqual(lost,[encounterFingerprint(abra)],'only the traded Abra left (the captured Spearow was traded too)');
 assert.equal(kept.length,originals.length+1,'exactly one new individual (Farfetch\'d replaced the Spearow; Mr. Mime replaced Abra)');
 console.log(`# ${fixture.id} verified `+JSON.stringify({steps:[...steps],frames:after.frame-result.start,farfetchd:{level:qmmLevel(farfetchd,inputs.battle),moves:farfetchd.moves},
  mime:{level:mime.level,moves:mime.moves},money:[before.playerMemory.trainer.money,after.playerMemory.trainer.money]}));
 return {before,after};
}

