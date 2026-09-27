import test from 'node:test';
import assert from 'node:assert/strict';
import * as traits from '../src/rng/target-traits.js';
const mechanics={species:{SPECIES_CHANSEY:{id:113,genderRatio:'MON_FEMALE',abilities:['ABILITY_NATURAL_CURE','ABILITY_SERENE_GRACE']}},abilities:{ABILITY_NATURAL_CURE:{id:30,name:'ABILITY_NATURAL_CURE'},ABILITY_SERENE_GRACE:{id:32,name:'ABILITY_SERENE_GRACE'}}};
const pokemon={species:113,personality:2809608280,nature:{name:'Bold'},ivs:{hp:31,spDefense:31},shiny:true};
test('RNG honors zero and upper-bound IV requirements while protecting an unmatched shiny',()=>{
 const request={maxIvs:{attack:0,specialAttack:15}};
 assert.equal(traits.evaluateRngTraits({...pokemon,ivs:{attack:0,spAttack:15}},request,mechanics).matched,true);
 const result=traits.evaluateRngTraits({...pokemon,ivs:{attack:1,spAttack:16}},request,mechanics);
 assert.deepEqual(result.unmet,['attack IV','specialAttack IV']);assert.equal(result.preserveShiny,true);
});
test('RNG preferences match source-game nature, IVs, ability slot and gender',()=>{
 const request={natures:['bold'],minIvs:{hp:31,specialDefense:31},gender:'female',abilityId:30};
 assert.equal(traits.evaluateRngTraits(pokemon,request,mechanics).matched,true);
 const result=traits.evaluateRngTraits({...pokemon,personality:2809608281,ivs:{hp:30,spDefense:31}},request,mechanics);
 assert.deepEqual(result.unmet.sort(),['ability','hp IV']);assert.equal(result.preserveShiny,true);
});
test('compatible competitive nature is inherited only when the catch has no explicit override',()=>{
 assert.equal(traits.evaluateRngTraits(pokemon,{competitive:{nature:'Bold',ability:'Natural Cure'}},mechanics).matched,true);
 assert.deepEqual(traits.evaluateRngTraits(pokemon,{natures:['adamant'],competitive:{nature:'Bold'}},mechanics).unmet,['nature']);
 const unavailable=traits.evaluateRngTraits(pokemon,{competitive:{ability:'Healer'}},mechanics);
 assert.equal(unavailable.matched,true);assert.ok(unavailable.deferred.includes('competitive ability'));
});
test('RNG filters the final evolution branch, ability slot and gender without discarding other shinies',()=>{
 const request={evolutionConstraints:{abilitySlots:[0],genderRate:4,gender:'female',personalityBranches:[{shift:16,modulus:10,remainders:[5,6,7,8,9]}]}};
 const p={...pokemon,personality:5*65536+12,abilityNum:0};
 assert.equal(traits.evaluateRngTraits(p,request,mechanics).matched,true);
 const wrong={...p,personality:2*65536+250,abilityNum:1};
 const result=traits.evaluateRngTraits(wrong,request,mechanics);
 assert.deepEqual(result.unmet.sort(),['evolution ability','evolution branch','evolution gender']);
 assert.equal(result.preserveShiny,true);
});
test('Hidden Power follows the Gen III IV bits: type from the lowest bit, power from the second',()=>{
 const ivs=(hp,attack,defense,spAttack,spDefense,speed)=>({hp,attack,defense,speed,spAttack,spDefense});
 assert.deepEqual(traits.hiddenPower(ivs(31,31,31,31,31,31)),{type:'dark',power:70});
 assert.deepEqual(traits.hiddenPower(ivs(0,0,0,0,0,0)),{type:'fighting',power:30});
 // Standard competitive spreads, listed HP/Atk/Def/SpA/SpD/Spe.
 assert.deepEqual(traits.hiddenPower(ivs(31,30,31,30,31,30)),{type:'fire',power:70});
 assert.deepEqual(traits.hiddenPower(ivs(31,30,30,31,31,31)),{type:'ice',power:70});
 assert.deepEqual(traits.hiddenPower(ivs(31,30,31,30,31,31)),{type:'grass',power:70});
 assert.deepEqual(traits.hiddenPower(ivs(31,31,31,30,31,31)),{type:'electric',power:70});
 assert.deepEqual(traits.hiddenPower(ivs(30,31,31,31,30,31)),{type:'steel',power:70});
 assert.equal(traits.hiddenPower({hp:31,attack:31}),null,'every IV must be readable');
 assert.equal(traits.HIDDEN_POWER_TYPES.length,16);assert.ok(!traits.HIDDEN_POWER_TYPES.includes('normal'));
});
test('RNG requests can target a Hidden Power type and minimum power',()=>{
 const fire={...pokemon,ivs:{hp:31,attack:30,defense:31,speed:30,spAttack:30,spDefense:31}};
 assert.equal(traits.evaluateRngTraits(fire,{hiddenPower:{type:'fire'}},mechanics).matched,true);
 assert.equal(traits.evaluateRngTraits(fire,{hiddenPower:{type:'fire',minPower:70}},mechanics).matched,true);
 const weak={...fire,ivs:{hp:1,attack:0,defense:1,speed:0,spAttack:0,spDefense:1}};
 assert.equal(traits.hiddenPower(weak.ivs).type,'fire');
 assert.deepEqual(traits.evaluateRngTraits(weak,{hiddenPower:{type:'fire',minPower:60}},mechanics).unmet,['hidden power']);
 const result=traits.evaluateRngTraits(fire,{hiddenPower:{type:'ice'}},mechanics);
 assert.deepEqual(result.unmet,['hidden power']);assert.equal(result.preserveShiny,true);
 assert.deepEqual(traits.evaluateRngTraits({...fire,ivs:{hp:31}},{hiddenPower:{type:'fire'}},mechanics).unmet,['hidden power']);
});
