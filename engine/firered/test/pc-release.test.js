import assert from "node:assert/strict";
import test from "node:test";
import {encounterFingerprint as fingerprint} from "../src/player/encounter-tracker.js";
import {selectReleasableHatchlings,releaseRefusal,eggStickerHatchRecords,releaseDemand,planHatchlingRelease,RELEASE_BATCH,RELEASE_BUFFER} from "../src/suite/pc-release.js";

// A minimal mechanics table: Rattata (medium fast) and Donphan (medium fast),
// Togepi (fast). Species ids are native FireRed ids.
const mechanics={species:Object.assign([],{19:{id:19,growthRate:"GROWTH_MEDIUM_FAST"},20:{id:20,growthRate:"GROWTH_MEDIUM_FAST"},
 175:{id:175,growthRate:"GROWTH_FAST"},232:{id:232,growthRate:"GROWTH_MEDIUM_FAST"}})};
const OT=1706568373;
let next=1000;
function mon({box=0,slot=0,species=19,personality=next++,otId=OT,shiny=false,isEgg=false,experience=125,friendship=120,metLevel=0,heldItem=0,moves=[33,39,0,0],pokerus=0,evs={hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0},validity="valid"}={}){
 return {box,slot,validity,personality,otId,shiny,species,heldItem,experience,friendship,evs,pokerus,moves,isEgg,metLevel,
  ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}};
}
const receipt=(p,requestId=`postgame-egg-sticker-hatch-${p.personality}-1`)=>({requestId,method:"breeding",pokemon:structuredClone(p),fingerprint:fingerprint(p),nativeSaveVerified:true,requestedSpecies:19,matched:true});
function world({hatchlings=5,extra=[],party=null}={}){
 const parentRattata=mon({box:0,slot:0,experience:352031,friendship:255,metLevel:3}),donphan=mon({box:0,slot:1,species:232,experience:1000000,metLevel:25});
 const born=Array.from({length:hatchlings},(_,i)=>mon({box:5,slot:i}));
 const storage=[parentRattata,donphan,...born,...extra];
 const counts=Array(14).fill(0);for(const p of storage)counts[p.box]++;
 const trainer={otId:OT,partyValidity:"valid",party:party??[mon({slot:0,species:149,experience:1e6,metLevel:21})],
  storage:{validity:"valid",currentBox:5,boxCounts:counts,pokemon:storage}};
 return {trainer,born,parentRattata,donphan,receipts:[...born.map(p=>receipt(p)),receipt(mon({species:19}),"postgame-national-collection-x")]};
}

test("only verified Egg-sticker hatchlings from the owner's own breeding are releasable",()=>{
 const {trainer,born,parentRattata,donphan,receipts}=world({hatchlings:4});
 const result=selectReleasableHatchlings({trainer,receipts,mechanics});
 assert.deepEqual(result.candidates.map(fingerprint),born.map(fingerprint));
 assert.deepEqual(result.species,[19],"the bred species come from the breeding record");
 assert.equal(releaseRefusal(parentRattata,{trainer,receipts,mechanics}),"not-hatched","the caught breeding parent");
 assert.equal(releaseRefusal(donphan,{trainer,receipts,mechanics}),"not-hatched");
 // A hatched level-5 Rattata that the Egg-sticker workflow never recorded.
 const stray=mon({box:9,slot:9});trainer.storage.pokemon.push(stray);trainer.storage.boxCounts[9]++;
 assert.equal(releaseRefusal(stray,{trainer,receipts,mechanics}),"no-egg-sticker-receipt");
 assert.ok(!selectReleasableHatchlings({trainer,receipts,mechanics}).candidates.includes(stray));
});

test("every owner criterion refuses a recorded hatchling that fails it",()=>{
 const cases={
  shiny:{shiny:true},"shiny-unknown":{shiny:null},egg:{isEgg:true},unverified:{validity:"unknown"},
  "other-trainer":{otId:OT+1},"not-hatched":{metLevel:5},trained:{experience:126},"trained-evs":{evs:{hp:1,attack:0,defense:0,speed:0,spAttack:0,spDefense:0}},
  "not-hatch-friendship":{friendship:70},"holds-item":{heldItem:13},"knows-hm":{moves:[33,57,0,0]},pokerus:{pokerus:0x21},
 };
 for(const [reason,change] of Object.entries(cases)){
  const {trainer,receipts}=world({hatchlings:2});
  const p=mon({box:6,slot:3,...change});
  trainer.storage.pokemon.push(p);trainer.storage.boxCounts[6]++;receipts.push(receipt(p));
  const expected=reason==="shiny-unknown"?"shiny":reason==="trained-evs"?"trained":reason;
  assert.equal(releaseRefusal(p,{trainer,receipts,mechanics}),expected,reason);
  assert.ok(!selectReleasableHatchlings({trainer,receipts,mechanics}).candidates.some(c=>fingerprint(c)===fingerprint(p)),reason);
 }
});

test("a hatchling without a decoded met level falls back to the level-5 experience and hatch friendship",()=>{
 const {trainer,receipts}=world({hatchlings:0});
 const legacy=mon({box:7,slot:0,metLevel:undefined,friendship:122}),caught=mon({box:7,slot:1,metLevel:undefined,friendship:70});
 for(const p of [legacy,caught]){trainer.storage.pokemon.push(p);trainer.storage.boxCounts[7]++;receipts.push(receipt(p));}
 assert.equal(releaseRefusal(legacy,{trainer,receipts,mechanics}),null);
 assert.equal(releaseRefusal(caught,{trainer,receipts,mechanics}),"not-hatch-friendship");
});

test("the full 32-bit trainer id must match, not only the visible id",()=>{
 const {trainer,receipts}=world({hatchlings:0});
 const sameVisible=mon({box:7,slot:2,otId:(OT&0xffff)|(((OT>>>16)^1)<<16)>>>0});
 trainer.storage.pokemon.push(sameVisible);trainer.storage.boxCounts[7]++;receipts.push(receipt(sameVisible));
 assert.equal(sameVisible.otId&0xffff,OT&0xffff);
 assert.equal(releaseRefusal(sameVisible,{trainer,receipts,mechanics}),"other-trainer");
});

test("party members, protected individuals and reserved slots are never candidates",()=>{
 const {trainer,born,receipts}=world({hatchlings:4});
 const inParty={...structuredClone(born[0]),slot:1};delete inParty.box;
 trainer.party.push(inParty);
 assert.equal(releaseRefusal(inParty,{trainer,receipts,mechanics}),"in-party");
 const result=selectReleasableHatchlings({trainer,receipts,mechanics,protectedFingerprints:[fingerprint(born[1])],protectedSlots:[{box:5,slot:2}]});
 assert.deepEqual(result.candidates.map(fingerprint),[fingerprint(born[3])],"the duplicated, protected and reserved hatchlings stay");
 assert.equal(releaseRefusal(born[1],{trainer,receipts,mechanics,protectedFingerprints:[fingerprint(born[1])]}),"protected");
 assert.equal(releaseRefusal(born[2],{trainer,receipts,mechanics,protectedSlots:[{box:5,slot:2}]}),"reserved-slot");
 assert.equal(releaseRefusal(born[0],{trainer,receipts,mechanics}),"in-party","an identity also in the party is never boxed-only");
});

test("the last individual of a species is kept across party and PC",()=>{
 const {trainer,born,parentRattata,receipts}=world({hatchlings:3});
 trainer.storage.pokemon=trainer.storage.pokemon.filter(p=>p!==parentRattata);
 const result=selectReleasableHatchlings({trainer,receipts,mechanics});
 assert.deepEqual(result.candidates.map(fingerprint),born.slice(0,2).map(fingerprint),"one Rattata remains");
 assert.equal(selectReleasableHatchlings({trainer,receipts,mechanics,limit:1}).candidates.length,1);
});

test("unverified party or storage evidence selects nothing",()=>{
 for(const change of [t=>{t.partyValidity="unknown";},t=>{t.storage.validity="partial";},t=>{t.otId=null;},t=>{t.storage.pokemon.push(mon({box:9,slot:0,validity:"unknown"}));}]){
  const {trainer,receipts}=world({hatchlings:3});change(trainer);
  assert.deepEqual(selectReleasableHatchlings({trainer,receipts,mechanics}).candidates,[]);
 }
});

test("receipts outside the Egg-sticker workflow or without a verified save are not provenance",()=>{
 const p=mon({box:3,slot:3});
 assert.equal(eggStickerHatchRecords([{...receipt(p),nativeSaveVerified:false}]).size,0);
 assert.equal(eggStickerHatchRecords([{...receipt(p),method:"game-corner"}]).size,0);
 assert.equal(eggStickerHatchRecords([receipt(p,"postgame-national-collection-breed-19-5")]).size,0);
 assert.equal(eggStickerHatchRecords([{...receipt(p),fingerprint:"[1,2,3]"}]).size,0,"the recorded fingerprint must be the recorded Pokémon");
 assert.equal(eggStickerHatchRecords([receipt(p)]).size,1);
});

test("release demand restores the shiny reserve plus a buffer",()=>{
 const trainer={partyValidity:"valid",party:Array(6).fill(mon()),storage:{validity:"valid",boxCounts:[30,30,30,30,30,30,30,30,29,30,30,30,30,1]}};
 assert.equal(RELEASE_BUFFER,20);assert.equal(RELEASE_BATCH,10);
 assert.equal(releaseDemand(trainer),20,"396 used: 30 free, the reserve alone");
 trainer.storage.boxCounts[13]=0;
 assert.equal(releaseDemand(trainer),19);
 assert.equal(releaseDemand({...trainer,partyValidity:"unknown"}),0);
});

test("a release plan starts in the open box and is bounded by the batch",()=>{
 const {trainer,receipts}=world({hatchlings:12});
 for(let i=0;i<3;i++){const p=mon({box:2,slot:10+i});trainer.storage.pokemon.push(p);trainer.storage.boxCounts[2]++;receipts.push(receipt(p));}
 trainer.storage.currentBox=5;
 const plan=planHatchlingRelease({trainer,receipts,mechanics,count:RELEASE_BATCH});
 assert.equal(plan.length,10);
 assert.ok(plan.every(e=>e.box===5),"the open box first");
 assert.deepEqual(plan.map(e=>e.slot),[0,1,2,3,4,5,6,7,8,9]);
 assert.deepEqual(Object.keys(plan[0]).sort(),["box","experience","fingerprint","friendship","metLevel","otId","personality","slot","species"]);
 trainer.storage.currentBox=13;
 assert.deepEqual(planHatchlingRelease({trainer,receipts,mechanics,count:4}).map(e=>[e.box,e.slot]),[[2,10],[2,11],[2,12],[5,0]],"then the next box in cursor order");
});

// ---- The release task: entry, per-release verification, save and handoff ----
import {PcReleaseTask,RELEASE_LABEL,releaseIdentityKeys} from "../src/suite/pc-release.js";
import {createPostgameAcquisition} from "../src/suite/native-acquisition.js";
const CENTER="MAP_FOUR_ISLAND_POKEMON_CENTER_1F";
function observation(trainer,{ui={},saved=100,sha="a".repeat(64),status=0,map=CENTER,phase="stable",frame=1}={}){
 return {phase,frame,sram:{sha256:sha},emulator:{mode:ui.storage?"storage":"overworld",inBattle:false,inputReady:true},
  playerMemory:{map:{id:map},trainer,ui,gameStats:{savedGame:saved},saveAttemptStatus:status}};
}
const without=(trainer,p)=>{const next=structuredClone(trainer);next.storage.pokemon=next.storage.pokemon.filter(q=>fingerprint(q)!==fingerprint(p));next.storage.boxCounts[p.box]--;return next;};
const storageUi=stage=>({storage:{stage,boxOption:"move-pokemon",cursorArea:"box",cursorPosition:0,currentBox:5,movingPokemon:false}});

test("the release task releases each planned hatchling, verifies nothing else changed, leaves the PC and saves",()=>{
 const {trainer,born,receipts}=world({hatchlings:3});
 const plan=planHatchlingRelease({trainer,receipts,mechanics,count:2});
 const task=createPostgameAcquisition({kind:"pc-release",requestId:"postgame-pc-release-9",plan,mechanics,world:{maps:[]}});
 const context={release:{receipts}};
 let next=task.inspect(observation(trainer),context);
 assert.equal(next.kind,"policy");
 assert.equal(next.objective.target.kind,"party-roster");
 assert.equal(next.objective.target.map,CENTER);
 assert.deepEqual(next.objective.target.release,plan[0]);
 assert.equal(next.objective.label,RELEASE_LABEL);
 // Inside the PC the same target is retained while the hatchling is present.
 next=task.inspect(observation(trainer,{ui:storageUi("pokemon-menu")}),context);
 assert.deepEqual(next.objective.target.release,plan[0]);
 // The cartridge purged exactly the planned hatchling (the "was released" message).
 let t=without(trainer,born[0]);
 next=task.inspect(observation(t,{ui:storageUi("release-message")}),context);
 assert.deepEqual(task.state.released.map(e=>e.fingerprint),[plan[0].fingerprint]);
 assert.equal(task.state.dirty,true,"an unsaved release owns the game until its native save");
 assert.deepEqual(next.objective.target.release,plan[1]);
 t=without(t,born[1]);
 next=task.inspect(observation(t,{ui:storageUi("storage-main")}),context);
 assert.equal(next.objective.target.kind,"map","leave the PC before saving");
 next=task.inspect(observation(t),context);
 assert.equal(next.objective.target.kind,"save-game");
 assert.equal(next.objective.target.saveVerified,false);
 // A restarted owner resumes the same transaction from its checkpoint.
 const resumed=createPostgameAcquisition({kind:"pc-release",requestId:"postgame-pc-release-9",state:JSON.parse(JSON.stringify(task.state)),mechanics,world:{maps:[]}});
 next=resumed.inspect(observation(t,{saved:101,sha:"b".repeat(64),status:1}),context);
 assert.equal(next.kind,"complete");
 assert.equal(next.receipt.method,"pc-release");
 assert.equal(next.receipt.nativeSaveVerified,true);
 assert.equal(next.receipt.savedSramSha256,"b".repeat(64));
 assert.deepEqual(next.receipt.released.map(e=>e.fingerprint),plan.map(e=>e.fingerprint));
 assert.deepEqual(next.receipt.refused,[]);
 assert.equal(resumed.state.dirty,false);
});

test("a PC that changed beyond the released hatchling stops the transaction",()=>{
 const {trainer,born,receipts}=world({hatchlings:3});
 const plan=planHatchlingRelease({trainer,receipts,mechanics,count:2});
 const context={release:{receipts}};
 for(const change of [
  t=>{const moved=t.storage.pokemon.find(p=>fingerprint(p)===fingerprint(born[2]));moved.slot=20;},
  t=>{t.storage.pokemon=t.storage.pokemon.filter(p=>fingerprint(p)!==fingerprint(born[2]));},
  t=>{t.party.pop();},
 ]){
  const task=new PcReleaseTask({requestId:"r",plan,mechanics});
  task.inspect(observation(trainer,{ui:storageUi("release-confirm")}),context);
  const t=without(trainer,born[0]);change(t);
  const next=task.inspect(observation(t,{ui:storageUi("release-message")}),context);
  assert.equal(next.kind,"stop");
  assert.match(next.reason,/changed beyond the released/);
 }
 // A planned hatchling that vanished without being the pending release.
 const task=new PcReleaseTask({requestId:"r",plan,mechanics});
 const next=task.inspect(observation(without(trainer,born[0])),context);
 assert.equal(next.kind,"stop");
});

test("a shiny, protected or changed individual placed in the plan is refused and left in place",()=>{
 const {trainer,born,receipts}=world({hatchlings:4});
 const shiny=mon({box:6,slot:0,shiny:true});trainer.storage.pokemon.push(shiny);trainer.storage.boxCounts[6]++;receipts.push(receipt(shiny));
 const entry=p=>({fingerprint:fingerprint(p),box:p.box,slot:p.slot,species:p.species,personality:p.personality,otId:p.otId,experience:p.experience,friendship:p.friendship,metLevel:p.metLevel});
 const plan=[entry(shiny),entry(born[1]),entry(born[2]),{...entry(born[3]),experience:999}];
 const task=new PcReleaseTask({requestId:"r",plan,mechanics});
 const context={release:{receipts,protectedIdentities:releaseIdentityKeys([{personality:born[1].personality,otId:born[1].otId}])}};
 const next=task.inspect(observation(trainer),context);
 assert.deepEqual(task.state.refused.map(e=>[e.fingerprint,e.reason]),[[fingerprint(shiny),"shiny"],[fingerprint(born[1]),"protected"]]);
 assert.deepEqual(next.objective.target.release,entry(born[2]),"only the eligible hatchling is attempted");
 const after=task.inspect(observation(without(trainer,born[2]),{ui:storageUi("release-message")}),context);
 assert.deepEqual(task.state.refused.at(-1),{...entry(born[3]),experience:999,reason:"plan-mismatch"});
 assert.equal(after.objective.target.kind,"map");
 // Refusing every entry releases nothing and needs no save.
 const none=new PcReleaseTask({requestId:"n",plan:[entry(shiny)],mechanics});
 const stopped=none.inspect(observation(trainer),context);
 assert.equal(stopped.kind,"stop");
 assert.equal(none.state.dirty,undefined);
 assert.match(stopped.reason,/shiny/);
});

test("the cartridge's own refusal is recorded and the hatchling stays",()=>{
 const {trainer,born,receipts}=world({hatchlings:3});
 const plan=planHatchlingRelease({trainer,receipts,mechanics,count:2}),context={release:{receipts}};
 const task=new PcReleaseTask({requestId:"r",plan,mechanics});
 task.inspect(observation(trainer,{ui:storageUi("release-confirm")}),context);
 const next=task.inspect(observation(trainer,{ui:storageUi("release-refused")}),context);
 assert.deepEqual(task.state.refused.map(e=>[e.fingerprint,e.reason]),[[plan[0].fingerprint,"cartridge-refused"]]);
 assert.deepEqual(next.objective.target.release,plan[1]);
});

test("identity keys cover fingerprints, lineages, {personality, otId} records and nested task state",()=>{
 const p=mon({personality:77,otId:OT});
 const keys=releaseIdentityKeys([fingerprint(p),JSON.stringify([78,OT,1,2,3,4,5,6]),{personality:79,otId:OT},{deep:{list:[{personality:80,otId:OT}]}},{byTrainee:{[`81:${OT}`]:2}},JSON.stringify([OT,82])]);
 for(const personality of [77,78,79,80,81,82])assert.ok(keys.has(`${personality}:${OT}`),String(personality));
 assert.ok(!keys.has(`83:${OT}`));
});
