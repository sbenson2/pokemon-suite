import {DELTA} from './world.mjs';
import {findPath} from './navigation.mjs';

// Native thin ice cracks on its first visit and breaks on its second.
// Search the complete remaining stage before committing any movement.
export function solveIcePath({start,ice,target,maxStates=250000}){
 const key=t=>`${t.x},${t.y}`,cells=new Map(ice.map(t=>[key(t),t])),goal=key(target),path=[];
 let states=0;
 const neighbors=t=>Object.entries(DELTA).map(([direction,{dx,dy}])=>({x:t.x+dx,y:t.y+dy,direction})).filter(t=>cells.has(key(t)));
 function visit(here){
  if(++states>maxStates)return false;
  if(!cells.size)return key(here)===goal;
  const choices=neighbors(here).sort((a,b)=>neighbors(a).length-neighbors(b).length);
  for(const next of choices){
   const k=key(next);if(k===goal&&cells.size>1)continue;
   const original=cells.get(k);cells.delete(k);path.push(next);
   // The unvisited floor must remain connected to the current tile.
   const seen=new Set([k]),queue=[next];
   for(let i=0;i<queue.length;i++)for(const n of neighbors(queue[i]))if(!seen.has(key(n))){seen.add(key(n));queue.push(n);}
   if(seen.size===cells.size+1&&visit(next))return true;
   path.pop();cells.set(k,original);
  }
  return false;
 }
 return visit(start)?path:null;
}

export function planSootopolisIce({world,grid,start,stepCount,constants,blockers=new Set()}){
 const stage=stepCount<8?{top:17,bottom:19}:stepCount<28?{top:12,bottom:14}:stepCount<67?{top:6,bottom:9}:null;
 if(!stage)return null;
 const thin=constants.behaviors.MB_THIN_ICE,cracked=constants.behaviors.MB_CRACKED_ICE,ice=[],blocked=new Set(blockers);
 for(let y=0;y<grid.height;y++)for(let x=0;x<grid.width;x++){
  const t=world.tile(grid,x,y);
  if(t.behavior===thin&&y>=stage.top&&y<=stage.bottom)ice.push({x,y});
  if(t.behavior===thin||t.behavior===cracked)blocked.add(`${x},${y}`);
 }
 const target={x:8,y:stage.top},here=world.tile(grid,start.x,start.y);
 if((here.behavior===thin||here.behavior===cracked)&&start.y>=stage.top&&start.y<=stage.bottom)return solveIcePath({start,ice:ice.filter(t=>t.x!==start.x||t.y!==start.y),target});
 for(const entry of ice){
  const avoid=new Set(blocked);avoid.delete(`${entry.x},${entry.y}`);
  const approach=findPath({world,grid,start,blockers:avoid,isGoal:t=>t.x===entry.x&&t.y===entry.y});
  if(!approach)continue;
  const rest=solveIcePath({start:entry,ice:ice.filter(t=>t!==entry),target});
  if(rest)return [...approach,...rest];
 }
 return null;
}
