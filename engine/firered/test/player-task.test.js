import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerTask} from '../src/suite/player-task.js';
const world={data:{maps:[{id:'MAP_PALLET_TOWN',objectEvents:[]},{id:'MAP_VIRIDIAN_CITY',objectEvents:[]}]}};
const observation=(map='MAP_PALLET_TOWN')=>({frame:1,phase:'stable',emulator:{mode:'overworld',inBattle:false,inputReady:true},sram:{sha256:'before'},playerMemory:{map:{id:map},position:{x:3,y:4},ui:{},trainer:{partyValidity:'valid',party:[],bag:{items:[]}},gameStats:{savedGame:5},saveAttemptStatus:1}});
test('a travel task stops at its destination only after the native save verifies',()=>{
 const task=new PlayerTask({request:{id:'walk',kind:'travel',map:'MAP_VIRIDIAN_CITY'},world});
 assert.equal(task.inspect(observation()).objective.target.map,'MAP_VIRIDIAN_CITY');
 const arrived=observation('MAP_VIRIDIAN_CITY');
 assert.equal(task.inspect(arrived).objective.target.kind,'save-game');
 assert.notEqual(task.inspect(arrived).kind,'complete');
 arrived.playerMemory.gameStats.savedGame=6;arrived.sram.sha256='saved';
 const restored=new PlayerTask({state:structuredClone(task.state),world});
 assert.equal(restored.inspect(arrived).kind,'complete');
});
test('collecting an item means acquiring the requested additional quantity',()=>{
 const o=observation();o.playerMemory.trainer.bag.items=[{itemId:68,quantity:2}];
 const task=new PlayerTask({request:{id:'candy',kind:'item',itemId:68,quantity:3},world,planner:{selectItemPreparation:()=>({id:'find-candy',target:{kind:'object',map:'MAP_PALLET_TOWN',index:0}})}});
 assert.equal(task.inspect(o).objective.id,'find-candy');
 o.playerMemory.trainer.bag.items[0].quantity=4;assert.equal(task.inspect(o).objective.id,'find-candy');
 o.playerMemory.trainer.bag.items[0].quantity=5;assert.equal(task.inspect(o).objective.target.kind,'save-game');
});
test('a task does not mark an arrival during battle or a menu transition',()=>{
 const task=new PlayerTask({request:{id:'walk',kind:'travel',map:'MAP_PALLET_TOWN'},world});
 const o=observation();o.emulator.inBattle=true;o.emulator.mode='battle';
 assert.notEqual(task.inspect(o).kind,'complete');assert.notEqual(task.state.phase,'saving');
});
test('unreachable item supply reports the actual limit instead of collecting something else',()=>{
 const task=new PlayerTask({request:{id:'candy',kind:'item',itemId:68,quantity:1},world,planner:{selectItemPreparation:()=>null}});
 assert.equal(task.inspect(observation()).kind,'stop');
});

// build 126 (extra saves): a helper parks with the individuals its tasks
// obtained. The goal is found by species among this save's own Pokémon, kept
// in the party with any loan subject, healed and saved in a Pokémon Center
// with a Direct Corner; the receipt grants exactly those individuals.
import {encounterFingerprint} from '../src/player/encounter-tracker.js';
const ivs={hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6};
const pkmn=(species,personality,extra={})=>({validity:'valid',species,personality,otId:2739568461,shiny:false,isEgg:false,heldItem:0,level:30,hp:50,maxHp:50,status1:0,moves:[33],pp:[35],ppBonuses:0,ivs,...extra});
const centerWorld={data:{maps:[{id:'MAP_CELADON_CITY',objectEvents:[]},{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F',objectEvents:[{script:'CeladonCity_PokemonCenter_1F_EventScript_Nurse'}]},
 {id:'MAP_CELADON_CITY_POKEMON_CENTER_2F',objectEvents:[{script:'Common_EventScript_DirectCornerAttendant'}]}]}};
const mechanics={data:{moves:[{id:33,pp:35}]}};
function parked(map,{party,pc=[]}){const o=observation(map);Object.assign(o.playerMemory.trainer,{otId:2739568461,party,storage:{validity:'valid',pokemon:pc}});return o;}
test('a helper parks its goal Pokémon in the party, healed and saved at a linked Center, and grants only it',()=>{
 const charizard=pkmn(6,1,{moves:[19]}),hitmonchan=pkmn(107,2),others=[3,4,5,6,7].map(n=>pkmn(20+n,n));
 const request={id:'park-08b8c4c8',kind:'park',map:'MAP_CELADON_CITY_POKEMON_CENTER_1F',goals:[{speciesId:107}],keep:[encounterFingerprint(charizard)]};
 const task=new PlayerTask({request,world:centerWorld,mechanics});
 const out=task.inspect(parked('MAP_CELADON_CITY',{party:[charizard,...others],pc:[hitmonchan]}));
 assert.equal(out.objective.target.kind,'party-roster');
 assert.deepEqual(out.objective.target.requiredFingerprints,[encounterFingerprint(hitmonchan),encounterFingerprint(charizard)]);
 const atCenter=parked('MAP_CELADON_CITY_POKEMON_CENTER_1F',{party:[charizard,hitmonchan,...others.slice(0,4)],pc:[others[4]]});
 atCenter.playerMemory.trainer.party[1]={...hitmonchan,hp:10};
 assert.equal(task.inspect(atCenter).objective.target.kind,'object','heal at the nurse first');
 atCenter.playerMemory.trainer.party[1]=hitmonchan;
 assert.equal(task.inspect(atCenter).objective.target.kind,'save-game');
 atCenter.playerMemory.gameStats.savedGame=6;atCenter.sram.sha256='parked';
 const restored=new PlayerTask({state:structuredClone(task.state),world:centerWorld,mechanics});
 const done=restored.inspect(atCenter);
 assert.equal(done.kind,'complete');
 assert.deepEqual(done.receipt.grants,[encounterFingerprint(hitmonchan)],'only the goal is granted; the lent Charizard stays this save\'s');
 assert.equal(done.receipt.center,'MAP_CELADON_CITY_POKEMON_CENTER_1F');assert.equal(done.receipt.savedSramSha256,'parked');
 assert.equal(done.receipt.pokemon[0].species,107);
});
test('a shiny, missing or ambiguous helper goal is never parked for trading',()=>{
 const request={id:'park-x',kind:'park',map:'MAP_CELADON_CITY_POKEMON_CENTER_1F',goals:[{speciesId:107}]};
 const shiny=new PlayerTask({request,world:centerWorld,mechanics}).inspect(parked('MAP_CELADON_CITY',{party:[pkmn(107,2,{shiny:true})]}));
 assert.equal(shiny.kind,'stop');assert.match(shiny.reason,/shiny/);
 assert.equal(new PlayerTask({request,world:centerWorld,mechanics}).inspect(parked('MAP_CELADON_CITY',{party:[pkmn(25,2)]})).kind,'stop');
 assert.equal(new PlayerTask({request,world:centerWorld,mechanics}).inspect(parked('MAP_CELADON_CITY',{party:[pkmn(107,2),pkmn(107,3)]})).kind,'stop');
 // Another trainer's Hitmonchan (a traded-in individual) is not this save's goal.
 assert.equal(new PlayerTask({request,world:centerWorld,mechanics}).inspect(parked('MAP_CELADON_CITY',{party:[pkmn(107,2,{otId:5})]})).kind,'stop');
 assert.throws(()=>new PlayerTask({request:{...request,map:'MAP_CELADON_CITY'},world:centerWorld}),/Pokémon Center/);
 assert.throws(()=>new PlayerTask({request:{...request,goals:[]},world:centerWorld}),/goal/);
});
