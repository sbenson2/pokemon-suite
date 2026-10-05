// Extra saves: the helper save's story choices. Kept free of player and
// suite imports so the campaign planner can use it without an import cycle.
// The default campaign (Helix Fossil, no goal) is returned unchanged.
import {STARTERS,FOSSILS} from './extra-saves.js';

const LAB='MAP_CINNABAR_ISLAND_POKEMON_LAB_EXPERIMENT_ROOM',LAB_ENTRANCE='MAP_CINNABAR_ISLAND_POKEMON_LAB_ENTRANCE';
const REVIVE_STATE=0x406A,WHICH_FOSSIL=0x4069;
// The Center each goal parks in: the first one after the goal on the story route.
export const HELPER_CENTERS=Object.freeze({starter:'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F',fossil:'MAP_CINNABAR_ISLAND_POKEMON_CENTER_1F'});
export const HELPER_GOAL_WATCH=Object.freeze({flags:Object.freeze([562,626,627,748,749,2089]),variables:Object.freeze([REVIVE_STATE,WHICH_FOSSIL,0x4031])});
// Cinnabar Island is reachable by Surf once the Soul Badge allows Surf in the
// field. The revival goes right before the next story badge after it, so a
// roster campaign's own captures after the Soul Badge stay ahead of it.
const REVIVAL_BEFORE='badge-marsh';

export function validateHelperGoal(goal){
 if(goal===null||goal===undefined)return null;
 if(!goal||typeof goal!=='object'||Array.isArray(goal))throw Error('Choose a supported helper goal.');
 if(goal.kind==='starter'&&Object.keys(goal).every(k=>['kind','starter'].includes(k))&&Object.hasOwn(STARTERS,goal.starter))return {kind:'starter',starter:goal.starter};
 if(goal.kind==='fossil'&&Object.keys(goal).every(k=>['kind','fossil'].includes(k))&&Object.hasOwn(FOSSILS,goal.fossil))return {kind:'fossil',fossil:goal.fossil};
 throw Error('A helper save stops at its starter or at its revived Mt. Moon fossil.');
}

// The story with the helper's choices. Only the Mt. Moon fossil objective and,
// for a fossil goal, three Cinnabar Lab revival objectives change.
export function applyStoryChoices(campaign,{fossil='helix',helperGoal=null}={}){
 const goal=validateHelperGoal(helperGoal);
 if(!['helix','dome'].includes(fossil))throw Error('Choose the Helix Fossil or the Dome Fossil.');
 if(goal?.kind==='fossil'&&goal.fossil!==fossil)throw Error('The helper goal must revive the fossil this save takes.');
 if(fossil==='helix'&&goal?.kind!=='fossil')return campaign;
 const choice=FOSSILS[fossil];
 const objectives=[];
 for(const objective of campaign.objectives){
  if(goal?.kind==='fossil'&&objective.id===REVIVAL_BEFORE)objectives.push(
   Object.freeze({id:'helper-fossil-hand-in',target:Object.freeze({kind:'object',map:LAB,index:1}),completion:Object.freeze({kind:'variable-at-least',id:REVIVE_STATE,value:1}),dialogue:'advance',choice:'yes',deferOptionalDetours:true}),
   Object.freeze({id:'helper-fossil-wait',target:Object.freeze({kind:'map-arrival',map:LAB_ENTRANCE}),completion:Object.freeze({kind:'variable-at-least',id:REVIVE_STATE,value:2}),dialogue:'advance',deferOptionalDetours:true}),
   Object.freeze({id:'helper-fossil-receive',target:Object.freeze({kind:'object',map:LAB,index:1}),completion:Object.freeze({kind:'flag-set',id:choice.revivedFlag}),dialogue:'advance',choice:'no',deferOptionalDetours:true}));
  objectives.push(objective.id==='mt-moon-fossil'&&fossil!=='helix'?Object.freeze({...objective,target:Object.freeze({...objective.target,index:choice.objectIndex}),completion:Object.freeze({kind:'flag-set',id:choice.flag})}):objective);
 }
 if(goal?.kind==='fossil'&&!objectives.some(o=>o.id==='helper-fossil-receive'))throw Error('The story has no point after which Cinnabar Island is reachable.');
 return Object.freeze({...campaign,objectives:Object.freeze(objectives)});
}

