const EXTERIOR='MAP_MT_EMBER_EXTERIOR',SUMMIT='MAP_MT_EMBER_SUMMIT';
const path=points=>points.map(([x,y])=>({x,y}));
const ascent=[
 {index:8,path:path([[22,45],[21,45],[20,45],[19,45]])},
 {index:9,path:path([[17,46],[16,46],[15,46],[14,46]])},
];
const summit=[
 {index:1,path:path([[10,12],[10,11]])},
 {index:2,path:path([[9,12],[8,12]])},
 {index:3,path:path([[8,11],[7,11]])},
 {index:4,path:path([[8,10],[8,9],[9,9],[10,9]])},
];
const same=(a,b)=>a?.x===b?.x&&a?.y===b?.y;
// Each push is selected from native object coordinates. Checkpoints retain the
// menu owner, not an assumed number of completed pushes. Map reloads reset it.
export function moltresApproach(o,state){
 const m=o.playerMemory,here=m.map.id;
 if(state.objective&&(o.phase!=='stable'||o.emulator.mode!=='overworld'||Object.values(m.ui??{}).some(Boolean)))return state.objective;
 if(state.map!==here){state.map=here;state.positions={};state.passageCleared=false;}
 const reach=map=>({id:'moltres-ascent-'+map,target:{kind:'map',map},dialogue:'advance',deferOptionalDetours:true});
 const pushRoute=(map,steps)=>{
  if(state.passageCleared)return null;
  if(!m.trainer.party.some(p=>p.validity==='valid'&&p.hp>0&&p.moves?.includes(70)))return {id:'moltres-strength-required',target:{kind:'stop-for-review',reason:'Mt. Ember needs a healthy Strength user in the party.'}};
  for(const b of steps){
   const live=m.objectEvents?.find(e=>e.localId===b.index+1&&!e.player)?.current;
   if(live)state.positions[b.index]={...live};
   const position=live??state.positions[b.index];
   if(same(position,b.path.at(-1)))continue;
   if(position&&!b.path.some(p=>same(p,position)))return {id:'moltres-boulder-review',target:{kind:'stop-for-review',reason:'A Mt. Ember boulder is outside its verified route. Preserve the current puzzle for review.'}};
   return {id:`moltres-boulder-${map}-${b.index}`,target:{kind:'push-boulder',map,objectIndex:b.index,...b.path.at(-1)},authoredBoulderPath:b.path,dialogue:'advance',choice:'yes',deferOptionalDetours:true};
  }
  // Native offscreen object recreation can restore a stone behind us. The
  // completed passage owns its exit until a map change, not those old stones.
  state.passageCleared=true;return null;
 };
 let selected;
 if(here===SUMMIT)selected=pushRoute(SUMMIT,summit);
 else if(here===EXTERIOR)selected=m.position.y>=24?(pushRoute(EXTERIOR,ascent)??reach('MAP_MT_EMBER_SUMMIT_PATH_1F')):reach(SUMMIT);
 else if(here==='MAP_MT_EMBER_SUMMIT_PATH_1F')selected=reach('MAP_MT_EMBER_SUMMIT_PATH_2F');
 else if(here==='MAP_MT_EMBER_SUMMIT_PATH_2F')selected=reach('MAP_MT_EMBER_SUMMIT_PATH_3F');
 else if(here==='MAP_MT_EMBER_SUMMIT_PATH_3F')selected=reach(EXTERIOR);
 else selected=reach(EXTERIOR);
 state.objective=selected??null;return state.objective;
}
