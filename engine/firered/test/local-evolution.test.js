import test from 'node:test';
import assert from 'node:assert/strict';
import * as evolution from '../src/suite/local-evolution.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';
import {FireRedEvolutionTask} from '../src/suite/fire-red-evolution.js';

const mon=(species,personality)=>({validity:'valid',species,personality,otId:456,shiny:true,isEgg:false,heldItem:0,ivs:{hp:31,attack:0,defense:8,speed:29,spAttack:22,spDefense:31},moves:[]});
const fixture=()=>{
 const source=mon(133,123),partner={...mon(385,789),shiny:false};
 const state={requestId:'umbreon',index:0,steps:[{kind:'trade',fromGame:'firered',toGame:'emerald',speciesId:133},{kind:'evolve',game:'emerald',fromSpecies:133,speciesId:197},{kind:'trade',fromGame:'emerald',toGame:'firered',speciesId:197},{kind:'verify',game:'firered',speciesId:197}]};
 return {source,partner,state};
};
test('a native restart proves the whole original party and trade count before allowing a retry',()=>{
 assert.equal(typeof evolution.proveUncommittedLocalTrade,'function');
 const source=mon(75,123),other=mon(9,987),party=[source,other];
 const state={requestId:'golem',pairId:'pair-one',leg:'outbound',trade:{map:'MAP_CENTER_2F',partyBefore:party.map(encounterFingerprint),tradeCountBefore:3}};
 const observation={emulator:{callback2:'CB2_Overworld',paletteFadeActive:false},playerMemory:{map:{id:'MAP_CENTER_2F'},trainer:{partyValidity:'valid',party},scripts:{fieldControlsLocked:false}}};
 const input={game:'firered',state,observation,wireless:{remotePlayers:0,tradeCount:3},sramSha256:'a'.repeat(64)};
 const proof=evolution.proveUncommittedLocalTrade(input);assert.equal(proof.outcome,'not-committed');assert.equal(proof.pairId,'pair-one');
 for(const change of [x=>x.observation.playerMemory.trainer.party[0].species=76,x=>x.observation.playerMemory.trainer.party[1].ivs.hp=30,x=>x.wireless.tradeCount=4,x=>x.wireless.remotePlayers=1,x=>x.state.trade.tradeCountBefore=null]){
  const invalid=structuredClone(input);change(invalid);assert.throws(()=>evolution.proveUncommittedLocalTrade(invalid),/native|party|counter|link/i);
 }
});
test('a retry requires both owners to prove the same uncommitted pair and stops after three retries',()=>{
 assert.equal(typeof evolution.verifyLocalTradeRestart,'function');
 const pair={requestId:'golem',pairId:'pair-one',leg:'outbound',restarts:0};
 const proof=game=>({...pair,game,outcome:'not-committed',nativeSaveVerified:true,savedSramSha256:'a'.repeat(64)});
 const both={firered:proof('firered'),emerald:proof('emerald')};
 assert.equal(evolution.verifyLocalTradeRestart(pair,both),true);
 for(const change of [x=>delete x.emerald,x=>x.emerald.pairId='old',x=>x.emerald.leg='return',x=>x.emerald.outcome='received',x=>x.firered.nativeSaveVerified=false]){
  const invalid=structuredClone(both);change(invalid);assert.throws(()=>evolution.verifyLocalTradeRestart(pair,invalid),/both|owner|pair|native/i);
 }
 assert.throws(()=>evolution.verifyLocalTradeRestart({...pair,restarts:3},both),/three/i);
});
test('the local reservation follows the saved route and returns the same individual to FireRed',()=>{
 const {source,partner,state}=fixture(),r=evolution.reserveLocalEvolution({evolution:state,source,partner});
 assert.equal(r.targetSpecies,197);assert.equal(r.method,'time');assert.equal(r.throughIndex,2);
 assert.equal(r.sourceFingerprint,encounterFingerprint(source));assert.equal(r.partnerFingerprint,encounterFingerprint(partner));
 assert.throws(()=>evolution.reserveLocalEvolution({evolution:state,source:{...source,species:25},partner}),/source/);
 assert.throws(()=>evolution.reserveLocalEvolution({evolution:{...state,steps:state.steps.slice(0,2)},source,partner}),/return/);
});
test('all original plain and held-item trade evolutions reserve the consumed item and exact return species',()=>{
 for(const [from,to,item] of [[64,65,0],[67,68,0],[75,76,0],[93,94,0],[61,186,187],[79,199,187],[95,208,199],[123,212,199],[117,230,201],[137,233,218],[366,367,192],[366,368,193]]){
  const internal=from===366?373:from,source={...mon(internal,123),heldItem:item},partner={...mon(385,789),shiny:false};
  const r=evolution.reserveLocalEvolution({evolution:{requestId:'trade',index:0,steps:[{kind:'trade',fromGame:'firered',toGame:'emerald',speciesId:from,evolution:{fromSpecies:from,speciesId:to}},{kind:'trade',fromGame:'emerald',toGame:'firered',speciesId:to}]},source,partner});
  assert.equal(r.method,'trade');assert.equal(r.targetSpecies,to);assert.equal(r.consumedItem,item||null);
 }
});
test('a temporary partner cannot be shiny, an egg, an HM carrier, or evolve during the trade',()=>{
 const okay={...mon(385,789),shiny:false};
 assert.equal(evolution.selectLocalTradePartner([mon(16,123),{...okay,moves:[57]},okay]).personality,789);
 assert.equal(evolution.selectLocalTradePartner([{...okay,isEgg:true},{...okay,species:64},{...okay,species:95,heldItem:199}]),null);
});

test('Beauty round trips reserve Feebas and reject irreversible preparation limits before transferring',()=>{
 const source={...mon(328,123),level:21,beauty:0,sheen:0},partner={...mon(385,789),shiny:false};
 const state={requestId:'milotic',index:0,steps:[{kind:'trade',fromGame:'firered',toGame:'emerald',speciesId:349},{kind:'evolve',game:'emerald',fromSpecies:349,speciesId:350},{kind:'trade',fromGame:'emerald',toGame:'firered',speciesId:350}]};
 const reserve=p=>evolution.reserveLocalEvolution({evolution:state,source:p,partner});
 assert.equal(reserve(source).method,'beauty');assert.equal(reserve(source).targetSpecies,350);
 assert.throws(()=>reserve({...source,level:100}),/100/);
 assert.throws(()=>reserve({...source,sheen:255}),/Sheen/);
});
const receipt=(r,game,leg,pokemon)=>({requestId:r.requestId,game,leg,nativeSaveVerified:true,handshakeVerified:true,linkClosedVerified:true,savedSramSha256:'a'.repeat(64),pokemon,offeredFingerprint:game==='firered'?(leg==='outbound'?r.sourceFingerprint:r.partnerFingerprint):(leg==='outbound'?r.partnerFingerprint:encounterFingerprint({...r.source,species:197}))});
test('both completed native exits and the evolved identity are required before the return can finish',()=>{
 const {source,partner,state}=fixture(),r=evolution.reserveLocalEvolution({evolution:state,source,partner});
 const out={firered:receipt(r,'firered','outbound',partner),emerald:receipt(r,'emerald','outbound',source)};
 assert.equal(evolution.verifyLocalEvolutionExchange(r,'outbound',out).species,133);
 const evolved={...source,species:197},back={firered:receipt(r,'firered','return',evolved),emerald:receipt(r,'emerald','return',partner)};
 assert.equal(evolution.verifyLocalEvolutionExchange(r,'return',back).species,197);
 for(const change of [x=>x.emerald.linkClosedVerified=false,x=>x.firered.pokemon.ivs.hp=30,x=>x.firered.pokemon.species=133,x=>x.emerald.requestId='other']){
  const invalid=structuredClone(back);change(invalid);assert.throws(()=>evolution.verifyLocalEvolutionExchange(r,'return',invalid),/verified|identity|species|request/);
 }
});

test('a parent advances past the external steps only when both legs and its current native return are verified',()=>{
 const {source,partner,state}=fixture(),r=evolution.reserveLocalEvolution({evolution:state,source,partner}),target={...source,species:197};
 const task=new FireRedEvolutionTask({requestId:'umbreon',sourceId:'eevee',pokemon:source,steps:state.steps,request:{speciesId:197,shiny:'required'}});
 const outbound={firered:receipt(r,'firered','outbound',partner),emerald:receipt(r,'emerald','outbound',source)},returned={firered:receipt(r,'firered','return',target),emerald:receipt(r,'emerald','return',partner)};
 const result={reservation:r,outbound,returned,evolution:{requestId:'umbreon',game:'emerald',pokemon:target,nativeSaveVerified:true,savedSramSha256:'b'.repeat(64)}};
 const o={frame:100,phase:'stable',sram:{sha256:'a'.repeat(64)},emulator:{mode:'overworld'},playerMemory:{trainer:{partyValidity:'valid',party:[target],storage:{validity:'valid',pokemon:[]}},ui:{}}};
 assert.throws(()=>task.acceptRoundTrip({...result,evolution:null},o),/evolution/);
 task.acceptRoundTrip(result,o);assert.equal(task.state.index,3);assert.equal(task.state.receipt.nationalSpeciesId,197);assert.equal(task.state.receipt.nativeSaveVerified,true);
 assert.throws(()=>task.acceptRoundTrip(result,o),/step/);
});
