import test from 'node:test';
import assert from 'node:assert/strict';
import {pokemonInventory,selectInventoryPokemon} from '../src/suite/pokemon-inventory.js';

const mon=(species,personality,extra={})=>({validity:'valid',species,personality,otId:42,
 ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},shiny:false,isEgg:false,...extra});
const trainer=()=>({partyValidity:'valid',party:[mon(25,123,{slot:0,level:20})],
 storage:{validity:'valid',currentBox:0,boxCounts:[1,...Array(13).fill(0)],pokemon:[mon(277,456,{box:0,slot:29,shiny:true})]}});

test('inventory includes ordinary party members and shiny PC residents with actual box positions',()=>{
 const result=pokemonInventory('firered',trainer());
 assert.equal(result.validity,'valid');assert.equal(result.pokemon.length,2);
 assert.equal(result.pokemon[0].location.kind,'party');assert.equal(result.pokemon[0].location.slot,0);
 assert.deepEqual(result.pokemon[1].location,{kind:'box',box:0,slot:29});
 assert.equal(result.pokemon[1].nationalSpeciesId,252);assert.equal(result.pokemon[1].shiny,true);
 assert.equal(result.boxes.length,14);assert.equal(result.boxes[0].used,1);
});
test('selection follows the same individual after moving slots and rejects duplicate identities',()=>{
 const t=trainer(),first=pokemonInventory('firered',t).pokemon[0];
 t.party[0].slot=3;
 assert.equal(selectInventoryPokemon('firered',t,first.id).personality,123);
 t.storage.pokemon.push({...t.party[0],box:1,slot:4});
 assert.throws(()=>selectInventoryPokemon('firered',t,first.id),/duplicated/);
 assert.equal(pokemonInventory('firered',t).pokemon.filter(p=>p.identityConflict).length,2);
});
test('unreadable storage, eggs and stale selections cannot become trade targets',()=>{
 const t=trainer(),id=pokemonInventory('firered',t).pokemon[0].id;
 t.party[0].isEgg=true;assert.throws(()=>selectInventoryPokemon('firered',t,id),/Egg/);
 t.party=[];assert.throws(()=>selectInventoryPokemon('firered',t,id),/missing/);
 t.storage.validity='unknown';assert.equal(pokemonInventory('firered',t).validity,'unknown');
 assert.throws(()=>selectInventoryPokemon('firered',t,id),/read/);
});
