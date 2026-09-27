import test from 'node:test';
import assert from 'node:assert/strict';
import * as tasks from '../src/suite/fire-red-evolution.js';
import {reserveLocalEvolution} from '../src/suite/local-evolution.js';
const mon=(species,id=100)=>({species,personality:id,otId:10,validity:'valid',shiny:false,isEgg:false,level:30,heldItem:0,moves:[],ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}});
const trainer=()=>({partyValidity:'valid',party:[mon(6,200)],storage:{validity:'valid',pokemon:[mon(64)]},pokedex:{ownedSpecies:[6,64]},bag:{}});
test('automatic partner routes reserve an ordinary spare and a verified native round trip',()=>{
 const t=trainer();assert.equal(tasks.selectOwnedPartnerEvolution?.({trainer:t,partnerAvailable:false}),null);
 const route=tasks.selectOwnedPartnerEvolution?.({trainer:t,partnerAvailable:true});assert.equal(route?.request.speciesId,65);
 const task=new tasks.FireRedEvolutionTask(route),reservation=reserveLocalEvolution({evolution:task.state,source:t.storage.pokemon[0],partner:mon(16,300)});
 assert.equal(reservation.method,'trade');assert.equal(reservation.targetSpecies,65);
 t.storage.pokemon[0].shiny=true;assert.equal(tasks.selectOwnedPartnerEvolution({trainer:t,partnerAvailable:true}),null);
 t.storage.pokemon[0].shiny=false;t.party.push(t.storage.pokemon.shift());assert.equal(tasks.selectOwnedPartnerEvolution({trainer:t,partnerAvailable:true}),null);
});
test('held trade items and time or Beauty requirements are planned before leaving FireRed',()=>{
 const t=trainer();t.storage.pokemon=[mon(95)];assert.equal(tasks.selectOwnedPartnerEvolution?.({trainer:t,partnerAvailable:true}),null);
 t.bag.items=[{itemId:199,quantity:1}];const steel=tasks.selectOwnedPartnerEvolution?.({trainer:t,partnerAvailable:true});assert.equal(steel?.steps[0].kind,'equip-evolution-item');assert.equal(steel.steps[0].item.nativeId,199);
 t.storage.pokemon=[mon(133)];const time=tasks.selectOwnedPartnerEvolution({trainer:t,partnerAvailable:true});assert.equal(time.steps[1].game,'emerald');assert.equal(time.steps[1].kind,'evolve');
 t.storage.pokemon[0].level=100;assert.equal(tasks.selectOwnedPartnerEvolution({trainer:t,partnerAvailable:true}),null);
 t.storage.pokemon=[{...mon(328),beauty:0,sheen:255}];assert.equal(tasks.selectOwnedPartnerEvolution({trainer:t,partnerAvailable:true}),null);
});

test('the automatic postgame owner accepts the verified round trip and releases partner preparation',async()=>{
 const {createPostgameController}=await import('../src/suite/postgame.js');
 const t=trainer(),route=tasks.selectOwnedPartnerEvolution({trainer:t,partnerAvailable:true}),task=new tasks.FireRedEvolutionTask(route),source=route.pokemon,partner=mon(16,300),target={...source,species:65};
 const reservation=reserveLocalEvolution({evolution:task.state,source,partner});
 const receipt=(game,leg,pokemon,offeredFingerprint)=>({requestId:route.requestId,game,leg,pokemon,offeredFingerprint,nativeSaveVerified:true,handshakeVerified:true,linkClosedVerified:true,savedSramSha256:'a'.repeat(64)});
 const fp=p=>JSON.stringify([p.species,p.personality,p.otId,1,2,3,4,5,6]);
 const result={reservation,outbound:{firered:receipt('firered','outbound',partner,fp(source)),emerald:receipt('emerald','outbound',target,fp(partner))},returned:{firered:receipt('firered','return',target,fp(partner)),emerald:receipt('emerald','return',partner,fp(target))}};
 const args={world:{data:{maps:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
 const controller=createPostgameController({...args,state:{schema:'pokemon-suite/postgame/v1',dexEvolution:task.state,preparation:{requestId:route.requestId,automatic:true,phase:'waiting-for-transfer'}}});
 const o={frame:100,phase:'stable',sram:{sha256:'a'.repeat(64)},emulator:{mode:'overworld'},playerMemory:{trainer:{partyValidity:'valid',party:[target],storage:{validity:'valid',pokemon:[]}},ui:{}}};
 controller.acceptEvolutionRoundTrip(result,o);assert.equal(controller.state().dexEvolution.index,2);
 controller.acknowledgeDexEvolution();assert.deepEqual(controller.state().preparation,{kind:'postgame',phase:'complete'});
});
