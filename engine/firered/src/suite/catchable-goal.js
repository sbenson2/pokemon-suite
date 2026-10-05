// The owner's postgame goal is per game: "catch all the Pokémon" means every
// species catchable in that game (build 124). LeafGreen's set is derived from
// its own wild tables, Game Corner prizes and in-game trades by
// scripts/derive-leafgreen-catchable.py, the same derivation as FireRed's goal
// (which it reproduces exactly with --version firered). FireRed's goal and its
// "X of N catchable in FireRed" summary belong to the collection work
// (national-dex-agenda.js, build 124); see the LeafGreen integration notes.
import leafGreenCatchable from './leafgreen-catchable.json' with {type:'json'};
import fireRedCatchable from './firered-catchable.json' with {type:'json'};

export const LEAFGREEN_CATCHABLE=Object.freeze(leafGreenCatchable.species.map(s=>s.id));
const goal=(game,title,data)=>Object.freeze({game,title,total:data.total,species:Object.freeze(data.species.map(s=>s.id)),
 onePerSave:Object.freeze(Object.fromEntries(data.species.filter(s=>s.onePerSave).map(s=>[s.id,Object.freeze([...s.onePerSave])])))});
// build 126: FireRed's goal (the collection work's firered-catchable.json) is
// readable here too; FireRed's status text still comes from national-dex-agenda.js.
const GOALS=Object.freeze({leafgreen:goal('leafgreen','LeafGreen',leafGreenCatchable),firered:goal('firered','FireRed',fireRedCatchable)});

export function catchableGoal(game){
 return GOALS[game]??null;
}

// ownedNationalIds: the Pokédex owned flags, which are National Dex numbers.
export function catchableProgress(game,ownedNationalIds){
 const goal=GOALS[game];
 if(!goal)throw new TypeError('A catchable goal is defined here for FireRed and LeafGreen.');
 if(!Array.isArray(ownedNationalIds))return null;
 const owned=new Set(ownedNationalIds),missing=goal.species.filter(id=>!owned.has(id));
 const count=goal.total-missing.length;
 return {game,title:goal.title,total:goal.total,owned:count,missing,text:`${count} of ${goal.total} catchable in ${goal.title}`};
}
