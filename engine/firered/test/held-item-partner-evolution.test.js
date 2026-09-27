import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOwnedPartnerEvolution,FireRedEvolutionTask} from '../src/suite/fire-red-evolution.js';

// Live September 23: the first held-item partner route (boxed Onix + Metal Coat
// → Steelix) stopped at its first step, "The source Pokémon is missing,
// duplicated, or evolved outside the expected step". The equip step names no
// species, so the source lookup matched nothing. The route must withdraw the
// boxed Onix and give it the Metal Coat before the trade.
const onix={species:95,personality:2078115889,otId:1706568373,validity:'valid',shiny:false,isEgg:false,level:13,heldItem:0,moves:[33,103,20,88],friendship:70,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}};
const lead={species:22,personality:1,otId:1706568373,validity:'valid',shiny:false,isEgg:false,level:100,heldItem:0,moves:[64,19,65,228],ivs:{hp:1,attack:1,defense:1,speed:1,spAttack:1,spDefense:1}};
const observation=(party,storage)=>({frame:100,phase:'stable',sram:{sha256:'a'.repeat(64)},emulator:{mode:'overworld',inBattle:false},
 playerMemory:{map:{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F'},position:{x:7,y:8},ui:{},gameStats:{savedGame:10},
  trainer:{partyValidity:'valid',party,storage:{validity:'valid',pokemon:storage},pokedex:{ownedSpecies:[22,95]},bag:{items:[{itemId:199,quantity:1}]}}}});

test('a held-item partner route finds its boxed source at the equip step',()=>{
 const o=observation([lead],[onix]);
 const route=selectOwnedPartnerEvolution({trainer:o.playerMemory.trainer,partnerAvailable:true});
 assert.equal(route?.request.speciesId,208);assert.equal(route.steps[0].kind,'equip-evolution-item');
 const task=new FireRedEvolutionTask(route);
 const first=task.inspect(o);
 assert.notEqual(first.kind,'stop',first.reason);
 assert.equal(first.objective?.target?.kind,'party-roster','withdraw the boxed Onix first');
 const withdrawn=observation([lead,onix],[]);
 const give=task.inspect(withdrawn);
 assert.notEqual(give.kind,'stop',give.reason);
 assert.equal(give.objective?.target?.kind,'give-held-item');assert.equal(give.objective.target.itemId,199);
 const equipped=observation([lead,{...onix,heldItem:199}],[]);equipped.playerMemory.trainer.bag.items=[];
 const next=task.inspect(equipped);
 assert.notEqual(next.kind,'stop',next.reason);
 assert.equal(task.state.index,1,'the equip step completes once Onix holds the Metal Coat');
});
