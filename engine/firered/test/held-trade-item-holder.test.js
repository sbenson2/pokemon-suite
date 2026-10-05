import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOwnedPartnerEvolution,partnerEvolutionNeeds,FireRedEvolutionTask} from '../src/suite/fire-red-evolution.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// Live October 4 (engine 125.1): with the FireRed partner ready, the main save
// still finished with "1 waits for the FireRed partner game to be ready for its
// trade round trip: politoed". Its only King's Rock is held by the party
// Dragonite (the held-item advisor equips it); Sevault Canyon's is walled. The
// partner route equipped only from the Bag and the spare check gave up on a
// missing Bag item, so no Poliwhirl was caught and no round trip started. A
// plain, unprotected teammate holding the trade item is a source: take it into
// the Bag, then equip the traded Pokémon.
const mon=(species,personality,more={})=>({species,personality,otId:1706568373,validity:'valid',shiny:false,isEgg:false,level:30,experience:30000,heldItem:0,friendship:70,hp:80,maxHp:80,status1:0,
 moves:[55],pp:[25],ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},...more});
const PARTNER={available:true,reason:null,partners:[{owner:'emerald',title:'emerald'},{owner:'firered-partner',title:'firered'}]};
const lead=mon(22,1,{slot:0,level:100,moves:[19]});
const dragonite=mon(149,3639020581,{slot:1,level:100,heldItem:187,moves:[57,63,17,200]});
const poliwhirl=mon(61,555,{box:2,slot:4,level:25});
const trainer=({party=[lead,dragonite],storage=[],bag=[]}={})=>({partyValidity:'valid',party,storage:{validity:'valid',pokemon:storage},bag:{items:bag},
 // Every species but Politoed is registered, so it is the only missing trade evolution.
 pokedex:{ownedSpecies:Array.from({length:386},(_,i)=>i+1).filter(id=>id!==186)}});
const observation=(t,more={})=>({frame:100,phase:'stable',sram:{sha256:'a'.repeat(64)},emulator:{mode:'overworld',inBattle:false,inputReady:true},
 playerMemory:{map:{id:'MAP_FOUR_ISLAND_POKEMON_CENTER_1F'},position:{x:7,y:8},ui:{},gameStats:{savedGame:10},storyState:{flagIds:{2089:true,2092:true,2112:true,2116:true}},trainer:t,...more}});

test('a King’s Rock held by a plain teammate still lets the partner route catch its Poliwhirl',()=>{
 const needs=partnerEvolutionNeeds({trainer:trainer(),partnerAvailable:PARTNER});
 assert.equal(needs?.rule.speciesId,186,'Politoed is the missing trade evolution');
 assert.equal(needs.itemId,null,'the held King’s Rock is not missing');
 assert.equal(needs.source,null,'a spare Poliwhirl is caught first');
});

test('the Politoed round trip takes the King’s Rock from its teammate first',()=>{
 const t=trainer({storage:[poliwhirl]});
 const route=selectOwnedPartnerEvolution({trainer:t,partnerAvailable:PARTNER,preferFireRed:true});
 assert.equal(route?.request.speciesId,186);
 assert.deepEqual(route.steps.map(s=>s.kind),['take-evolution-item','equip-evolution-item','trade','trade','verify']);
 assert.equal(route.steps[0].holder,encounterFingerprint(dragonite));assert.equal(route.steps[0].item.nativeId,187);
 assert.equal(route.steps[2].partner,'firered-partner');
});

test('a shiny or protected holder, or one holding something else, is never used',()=>{
 for(const holder of [{...dragonite,shiny:true},{...dragonite,heldItem:0}]){
  const t=trainer({party:[lead,holder],storage:[poliwhirl]});
  assert.equal(selectOwnedPartnerEvolution({trainer:t,partnerAvailable:PARTNER,preferFireRed:true}),null);
  assert.equal(partnerEvolutionNeeds({trainer:trainer({party:[lead,holder]}),partnerAvailable:PARTNER}),null);
 }
 const t=trainer({storage:[poliwhirl]});
 assert.equal(selectOwnedPartnerEvolution({trainer:t,partnerAvailable:PARTNER,preferFireRed:true,protectedFingerprints:[encounterFingerprint(dragonite)]}),null);
});

test('the task takes the item, withdraws the Poliwhirl and equips it before the trade',()=>{
 const route=selectOwnedPartnerEvolution({trainer:trainer({storage:[poliwhirl]}),partnerAvailable:PARTNER,preferFireRed:true});
 const task=new FireRedEvolutionTask(route);
 const take=task.inspect(observation(trainer({storage:[poliwhirl]})));
 assert.equal(take.kind,'policy',take.reason);
 assert.deepEqual(take.objective.target,{kind:'take-held-item',map:'MAP_FOUR_ISLAND_POKEMON_CENTER_1F',fingerprint:encounterFingerprint(dragonite),itemId:187});
 const taken=trainer({party:[lead,{...dragonite,heldItem:0}],storage:[poliwhirl],bag:[{itemId:187,quantity:1}]});
 const withdraw=task.inspect(observation(taken));
 assert.equal(task.state.index,1,'the take step completes with the King’s Rock in the Bag');
 assert.equal(withdraw.objective?.target?.kind,'party-roster','withdraw the boxed Poliwhirl');
 const withdrawn=trainer({party:[lead,{...dragonite,heldItem:0},{...poliwhirl,slot:2}],bag:[{itemId:187,quantity:1}]});
 const give=task.inspect(observation(withdrawn));
 assert.equal(give.objective?.target?.kind,'give-held-item');assert.equal(give.objective.target.itemId,187);
 const equipped=trainer({party:[lead,{...dragonite,heldItem:0},{...poliwhirl,slot:2,heldItem:187}]});
 assert.equal(task.inspect(observation(equipped)).kind,'external','the trade itself is the partner round trip');
});

test('a holder that no longer holds the item falls back to an ordinary supply',()=>{
 const route=selectOwnedPartnerEvolution({trainer:trainer({storage:[poliwhirl]}),partnerAvailable:PARTNER,preferFireRed:true});
 const task=new FireRedEvolutionTask(route);
 const next=task.inspect(observation(trainer({party:[lead,{...dragonite,heldItem:0}],storage:[poliwhirl]})));
 assert.equal(next.kind,'supply');assert.equal(next.item.nativeId,187);
});
