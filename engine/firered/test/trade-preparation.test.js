import test from 'node:test';
import assert from 'node:assert/strict';
import {TradePreparation} from '../src/suite/trade-preparation.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';
const pokemon={validity:'valid',species:143,personality:123,otId:456,ivs:{hp:27,attack:30,defense:25,speed:20,spAttack:20,spDefense:21},shiny:true,hp:100,maxHp:100,status1:0,moves:[29],pp:[15]};
const center='MAP_LAVENDER_TOWN_POKEMON_CENTER_1F';
const mechanics={moves:[{id:29,pp:15}]};
const receipt={state:'saved-awaiting-partner',requestId:'hunt',pokemon,fingerprint:encounterFingerprint(pokemon)};
const observation=()=>({phase:'stable',emulator:{mode:'overworld'},sram:{sha256:'before'},playerMemory:{map:{id:'MAP_ROUTE12'},ui:{},gameStats:{savedGame:7},trainer:{partyValidity:'valid',party:[{...pokemon,species:18,personality:999}],storage:{validity:'valid',pokemon:[pokemon]},bag:{}}}});
const prepare=(state=null)=>new TradePreparation({receipt,center,nurseIndex:0,mechanics,state});
test('an ordinary inventory selection still needs a new native save before it is ready',()=>{
 const p=new TradePreparation({receipt:{...receipt,state:'owned-awaiting-save'},center,nurseIndex:0,mechanics});
 const o=observation();o.playerMemory.map.id=center;o.playerMemory.trainer.party=[{...pokemon,shiny:false}];o.playerMemory.trainer.storage.pokemon=[];
 assert.equal(p.inspect(o).objective.target.kind,'save-game');
 assert.equal(p.state.nativeSaveVerified,undefined);
 o.playerMemory.gameStats.savedGame=8;o.playerMemory.saveAttemptStatus=1;o.sram.sha256='saved-new';
 assert.equal(p.inspect(o).kind,'ready');assert.equal(p.state.nativeSaveVerified,true);
});
test('withdraws the exact captured individual, heals at the center, and requires a fresh native save',()=>{
 const p=prepare(),o=observation();
 assert.equal(p.inspect(o).objective.target.kind,'party-roster');
 o.playerMemory.map.id=center;o.playerMemory.trainer.party.push({...pokemon,hp:20,status1:2,pp:[1]});o.playerMemory.trainer.storage.pokemon=[];
 assert.equal(p.inspect(o).objective.id,'trade-heal-party');
 o.playerMemory.trainer.party[1]={...pokemon};
 assert.equal(p.inspect(o).objective.target.kind,'save-game');
 // Seeing the previous save's success callback cannot complete this task.
 o.playerMemory.saveAttemptStatus=1;o.playerMemory.ui.saveDialog={stage:'success'};
 assert.equal(p.inspect(o).objective.target.saveVerified,false);
 o.playerMemory.gameStats.savedGame=8;o.sram.sha256='after';
 assert.equal(p.inspect(o).objective.target.saveVerified,true);
 const resumed=prepare(p.state);o.playerMemory.ui={};
 assert.equal(resumed.inspect(o).kind,'ready');
 assert.equal(resumed.state.pokemon.personality,123);
});
test('stops on missing or duplicated identities instead of substituting a Snorlax',()=>{
 for(const stored of [[],[pokemon,pokemon]]){
  const o=observation();o.playerMemory.trainer.storage.pokemon=stored;
  assert.equal(prepare().inspect(o).kind,'stop');
 }
});
test('requests the selected fingerprint when another Pokémon of the same species exists',()=>{
 const o=observation();o.playerMemory.trainer.storage.pokemon.push({...pokemon,personality:789});
 assert.deepEqual(prepare().inspect(o).objective.target.requiredFingerprints,[receipt.fingerprint]);
});
test('does not declare ready while the PC or nurse dialog is still open, and retains depleted PP as a healing need',()=>{
 const p=prepare(),o=observation();o.playerMemory.map.id=center;
 o.playerMemory.trainer.party.push({...pokemon,pp:[1]});o.playerMemory.trainer.storage.pokemon=[];
 o.playerMemory.ui.storage={stage:'pc-menu'};
 assert.equal(p.inspect(o).objective.target.kind,'party-roster');
 o.playerMemory.ui={};assert.equal(p.inspect(o).objective.id,'trade-heal-party');
 o.playerMemory.trainer.party[1]={...pokemon};o.playerMemory.ui.fieldDialog={stage:'awaiting-close'};
 assert.equal(p.inspect(o).objective.id,'trade-heal-party');
 o.playerMemory.ui={};assert.equal(p.inspect(o).objective.target.kind,'save-game');
});
test('cannot prepare an unverified catch or restore another capture’s preparation',()=>{
 assert.throws(()=>new TradePreparation({receipt:{...receipt,state:'catching'},center,nurseIndex:0,mechanics}),/saved capture/);
 assert.throws(()=>prepare({...prepare().state,fingerprint:'different'}),/another capture/);
});
test('leaves the PC root after withdrawing, instead of reopening storage',()=>{
 const p=prepare(),o=observation();o.playerMemory.map.id=center;
 o.playerMemory.trainer.party.push({...pokemon,hp:50});o.playerMemory.trainer.storage.pokemon=[];
 o.playerMemory.ui.choiceMenu={maxCursor:2,cursor:0};
 assert.equal(p.inspect(o).objective.id,'trade-heal-party');
});
test('sails from a Sevii island to the Kanto trade center instead of waiting for an unsupported route',()=>{
 // Live, Sept 27: a Switch trade selected at the Four Island Sticker Man's
 // house waited 15 minutes on "No executable route" to Lavender.
 const world={data:{maps:[{id:'MAP_FOUR_ISLAND_HARBOR',warpEvents:[{dest_map:'MAP_FOUR_ISLAND'}]}]}};
 const p=new TradePreparation({receipt,center,nurseIndex:0,mechanics,world}),o=observation();
 o.playerMemory.map.id='MAP_FOUR_ISLAND_HOUSE2';
 assert.deepEqual(p.inspect(o).objective.target,{kind:'map',map:'MAP_FOUR_ISLAND'});
 o.playerMemory.map.id='MAP_FOUR_ISLAND_HARBOR';
 assert.deepEqual(p.inspect(o).objective.target,{kind:'seagallop-destination',map:'MAP_VERMILION_CITY'});
 assert.equal(p.state.phase,'party');
 // Back in Kanto the unchanged withdrawal objective resumes.
 o.playerMemory.map.id='MAP_VERMILION_CITY';
 assert.equal(p.inspect(o).objective.id,'trade-withdraw-capture');
});
