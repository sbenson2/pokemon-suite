// Extra saves, part 3: goal-driven helper FireRed saves. A helper save is an
// ordinary story campaign with one-per-save choices (starter, Mt. Moon fossil)
// that stops as soon as its goal individual is obtained and saved in a Pokémon
// Center with a Direct Corner, ready to trade with the main save. The default
// campaign (Helix Fossil, no goal) is unchanged: applyStoryChoices returns the
// same campaign object. Controller inputs only; no memory writes.
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
import {TradePreparation} from './trade-preparation.js';
import {STARTERS,FOSSILS,centerWithLink} from './extra-saves.js';

import {validateHelperGoal,HELPER_CENTERS} from './extra-save-story.js';
export {validateHelperGoal,applyStoryChoices,HELPER_CENTERS,HELPER_GOAL_WATCH} from './extra-save-story.js';

const nurse=(world,center)=>(world.data??world).maps.find(m=>m.id===center)?.objectEvents?.findIndex(e=>/EventScript_Nurse$/.test(e.script))??-1;
// Whether the helper save holds its goal individual yet, then park it: party,
// healed, saved in the goal's Center. Returns continue (keep playing the
// story), policy (the park step), reached, or stop.
export function inspectHelperGoal({observation:o,goal,state,world,mechanics}){
 const g=validateHelperGoal(goal),m=o?.playerMemory??{},t=m.trainer??{},f=m.storyState?.flagIds??{},v=m.storyState?.variableIds??{};
 if(!g)return {kind:'continue'};
 if(state.receipt)return {kind:'reached',receipt:state.receipt};
 if(o?.phase!=='stable'||o.emulator?.inBattle||t.partyValidity!=='valid'||t.storage?.validity!=='valid'||!Number.isInteger(t.otId))return state.target?{kind:'wait'}:{kind:'continue'};
 const own=[...t.party,...t.storage.pokemon].filter(p=>p?.validity==='valid'&&!p.isEgg&&p.otId===t.otId);
 let family,obtained;
 if(g.kind==='starter'){
  const want=STARTERS[g.starter],chose=['bulbasaur','squirtle','charmander'][v[0x4031]];
  if(Number.isInteger(v[0x4031])&&own.some(p=>Object.values(STARTERS).some(s=>s.family.includes(nationalSpeciesId(p.species))))&&chose!==g.starter)return {kind:'stop',reason:`This helper save chose another starter than ${want.label}.`};
  family=want.family;obtained=f[2089]===true;
 }else{
  const want=FOSSILS[g.fossil],other=g.fossil==='dome'?FOSSILS.helix:FOSSILS.dome;
  if(f[other.flag]===true)return {kind:'stop',reason:`This helper save took the ${other.label}; the ${want.label} is no longer available in it.`};
  family=want.family;obtained=f[want.revivedFlag]===true;
 }
 const matches=own.filter(p=>family.includes(nationalSpeciesId(p.species)));
 if(!obtained||!matches.length)return state.target?{kind:'stop',reason:'The helper goal individual left this save.'}:{kind:'continue'};
 const target=state.target?matches.find(p=>encounterFingerprint(p)===state.target):matches.length===1?matches[0]:null;
 if(!target)return {kind:'stop',reason:'The helper goal individual is missing or ambiguous.'};
 if(target.shiny)return {kind:'stop',reason:'The helper goal individual is shiny. It stays in this save and is never offered.'};
 state.target=encounterFingerprint(target);state.goal=g;
 const center=HELPER_CENTERS[g.kind],index=nurse(world,center);
 if(!(index>=0)||!centerWithLink(center,world))return {kind:'stop',reason:'The helper save\'s Pokémon Center with a Direct Corner could not be verified.'};
 const prep=new TradePreparation({receipt:{requestId:'helper-goal',fingerprint:state.target,state:'owned-awaiting-save'},center,nurseIndex:index,mechanics,world,state:state.transfer??null});
 const next=prep.inspect(o);state.transfer=prep.state;
 if(next.kind==='stop')return next;
 if(next.kind!=='ready')return next.kind==='policy'?{kind:'policy',objective:{...next.objective,id:`helper-goal-${next.objective.id}`}}:{kind:'wait'};
 const pokemon=t.party.find(p=>encounterFingerprint(p)===state.target);
 state.receipt={schema:'pokemon-suite/helper-goal/v1',goal:g,pokemon:structuredClone(pokemon),fingerprint:state.target,species:nationalSpeciesId(pokemon.species),center,
  trainerId:t.trainerId,lineage:String(t.otId>>>0),grants:[state.target],nativeSaveVerified:true,savedSramSha256:o.sram?.sha256??null,savedFrame:o.frame};
 return {kind:'reached',receipt:state.receipt};
}
