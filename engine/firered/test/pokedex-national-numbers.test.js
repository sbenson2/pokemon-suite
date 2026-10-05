import test from 'node:test';
import assert from 'node:assert/strict';
import {nationalDexProgress} from '../src/suite/postgame-progress.js';
import {ownedDexEvolutionOptions,selectOwnedPartnerEvolution} from '../src/suite/fire-red-evolution.js';
import {collectionStorage} from '../src/suite/storage-capacity.js';
import {captureBallMultiplier} from '../src/player/capture-balls.js';
import {nationalSpeciesId} from '../src/evidence/gen3-national-species.js';

// The observer decodes the Pokédex owned flags bit n -> National Dex n
// (fire-red-observer.js decodePokedex; pokefirered stores the flags by National
// number). Party and PC records carry INTERNAL species ids. Converting the
// Pokédex list with nationalSpeciesId counted this save's Castform (#351) as
// Spoink (#325) and dropped #252-#276 (research pass, September 28).
const internal=n=>{for(let i=0;i<440;i++)if(nationalSpeciesId(i)===n)return i;return null;};

test('Pokédex progress reads owned flags as National Dex numbers',()=>{
 const castform=nationalDexProgress([351]);
 assert.equal(castform.caught,1);
 assert.ok(!castform.missing.includes(351),'Castform is registered');
 assert.ok(castform.missing.includes(325),'Spoink is still missing');
 assert.equal(nationalDexProgress([252,276]).caught,2,'Treecko and Taillow are not dropped');
 assert.equal(nationalDexProgress([1,151,386]).caught,3);
});

test('evolution choices compare National Pokédex numbers with converted individuals',()=>{
 // Dex owns Treecko (#252) and Wingull (#278); internal 278 is Grovyle, so the
 // old conversion hid Grovyle (#253) as already registered.
 const treecko={validity:'valid',species:internal(252),personality:5,otId:9,shiny:false,isEgg:false,level:20,heldItem:0,friendship:70,moves:[1],ivs:{hp:1,attack:1,defense:1,speed:1,spAttack:1,spDefense:1}};
 const trainer={partyValidity:'valid',party:[],storage:{validity:'valid',pokemon:[treecko],boxCounts:Array(14).fill(0)},bag:{},pokedex:{ownedSpecies:[252,278]}};
 assert.ok(ownedDexEvolutionOptions({trainer,scope:'national'}).some(x=>x.rule.speciesId===253),'Grovyle is missing and can be evolved');
 trainer.pokedex.ownedSpecies.push(253);
 assert.ok(!ownedDexEvolutionOptions({trainer,scope:'national'}).some(x=>x.rule.speciesId===253),'a registered Grovyle is not evolved again');
 assert.equal(typeof selectOwnedPartnerEvolution,'function');
});

test('postgame storage counts every registered National Dex entry',()=>{
 const trainer={partyValidity:'valid',party:[],storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)},pokedex:{ownedSpecies:[252,351]}};
 assert.equal(collectionStorage(trainer,{scope:'postgame'}).remainingTargets,384);
});

test('a Repeat Ball reads an internal opponent species against National Pokédex flags',()=>{
 const mechanics={data:{species:[]}};
 const repeat=owned=>captureBallMultiplier({itemId:9,opponent:{species:internal(252)},mechanics,ownedSpecies:owned});
 assert.equal(repeat([252]),30,'a registered Treecko gets the Repeat Ball bonus');
 assert.equal(repeat([internal(252)]),10,'the internal number of a different species is not a registration');
});
