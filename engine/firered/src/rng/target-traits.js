import {FIRE_RED_NATURES} from '../evidence/pokemon-record.js';
import {GEN3_ABILITIES} from '../evidence/gen3-abilities.js';
const normalize=value=>String(value??'').replace(/^ABILITY_/,'').replaceAll('_',' ').toLowerCase();
// Gen III Hidden Power: the type comes from each IV's lowest bit and the power
// from its second bit, in the order HP, Attack, Defense, Speed, Sp. Atk, Sp. Def.
export const HIDDEN_POWER_TYPES=Object.freeze(['fighting','flying','poison','ground','rock','bug','ghost','steel','fire','water','grass','electric','psychic','ice','dragon','dark']);
export function hiddenPower(ivs){
 const order=['hp','attack','defense','speed','spAttack','spDefense'].map(stat=>ivs?.[stat]);
 if(!order.every(iv=>Number.isInteger(iv)&&iv>=0&&iv<=31))return null;
 const bits=shift=>order.reduce((sum,iv,index)=>sum+(((iv>>shift)&1)<<index),0);
 return {type:HIDDEN_POWER_TYPES[Math.floor(bits(0)*15/63)],power:Math.floor(bits(1)*40/63)+30};
}
export function hiddenPowerMatches(ivs,wanted){
 if(!wanted)return true;
 const actual=hiddenPower(ivs);
 return Boolean(actual)&&(!wanted.type||actual.type===wanted.type)&&(!wanted.minPower||actual.power>=wanted.minPower);
}
export function evaluateRngTraits(pokemon,request={},mechanics={}){
 const data=mechanics.data??mechanics,species=Object.values(data.species??{}).find(s=>s.id===pokemon.species),unmet=[],deferred=[];
 const preset=request.competitive;
 const natures=request.natures?.length?request.natures:preset?.nature&&FIRE_RED_NATURES.some(n=>normalize(n)===normalize(preset.nature))?[preset.nature]:[];
 if(natures.length&&!natures.some(n=>normalize(n)===normalize(pokemon.nature?.name)))unmet.push('nature');
 for(const [stat,min] of Object.entries(request.minIvs??{})){
  const key={specialAttack:'spAttack',specialDefense:'spDefense'}[stat]??stat;
  if(!Number.isInteger(pokemon.ivs?.[key])||pokemon.ivs[key]<min)unmet.push(`${stat} IV`);
 }
 for(const [stat,max] of Object.entries(request.maxIvs??{})){
  const key={specialAttack:'spAttack',specialDefense:'spDefense'}[stat]??stat;
  if((!Number.isInteger(pokemon.ivs?.[key])||pokemon.ivs[key]>max)&&!unmet.includes(`${stat} IV`))unmet.push(`${stat} IV`);
 }
 if(request.hiddenPower&&!hiddenPowerMatches(pokemon.ivs,request.hiddenPower))unmet.push('hidden power');
 const slots=species?.abilities??[];
 let desired=request.abilityId!=null?slots.findIndex(name=>GEN3_ABILITIES[name]===request.abilityId||Object.values(data.abilities??{}).some(a=>a.id===request.abilityId&&a.name===name)):-1;
 if(request.abilityId!=null&&desired<0)unmet.push('ability');
 if(request.abilityId==null&&preset?.ability){desired=slots.findIndex(name=>normalize(name)===normalize(preset.ability));if(desired<0)deferred.push('competitive ability');}
 if(desired>=0){const actual=pokemon.abilityNum??(pokemon.personality&1);const effective=slots[1]&&slots[1]!=='ABILITY_NONE'&&slots[1]!==slots[0]?actual:0;if(desired!==effective)unmet.push('ability');}
 if(request.gender&&request.gender!=='any'){
  const ratio=species?.genderRatio;
  const percent=ratio?.call==='PERCENT_FEMALE'?[null,ratio.args[0]]:String(ratio).match(/PERCENT_FEMALE\(([^)]+)\)/);
  const gender=ratio==='MON_GENDERLESS'?'genderless':ratio==='MON_FEMALE'?'female':ratio==='MON_MALE'?'male':percent?(pokemon.personality&255)<Math.floor(Number(percent[1])*255/100)?'female':'male':null;
  if(gender!==request.gender)unmet.push('gender');
 }
 if(request.encounterLevel&&Number.isInteger(pokemon.level)&&(pokemon.level<request.encounterLevel.min||pokemon.level>request.encounterLevel.max))unmet.push('encounter level');
 const evolution=request.evolutionConstraints;
 if(evolution){
  // Gen III retains the stored ability number on evolution. A one-ability
  // source is created in slot zero even when its PID is odd.
  const slot=pokemon.abilityNum??(slots[1]&&slots[1]!=='ABILITY_NONE'?(pokemon.personality&1):0);
  if(evolution.abilitySlots&&!evolution.abilitySlots.includes(slot))unmet.push('evolution ability');
  if(evolution.gender&&evolution.gender!=='any'){
   const rate=evolution.genderRate;
   const gender=rate===-1?'genderless':rate===8?'female':rate===0?'male':(pokemon.personality&255)<Math.floor(rate*255/8)?'female':'male';
   if(gender!==evolution.gender)unmet.push('evolution gender');
  }
  if(evolution.personalityBranches?.some(b=>!b.remainders.includes((pokemon.personality>>>b.shift)%b.modulus)))unmet.push('evolution branch');
 }
 return {matched:unmet.length===0,unmet,deferred,preserveShiny:pokemon.shiny===true};
}
