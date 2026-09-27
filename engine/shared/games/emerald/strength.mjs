// Solve before pushing. Only native walking and Strength inputs execute this
// plan; every push is followed by a fresh observation of the real boulders.
import {canStep,DELTA,nextElevation} from './world.mjs';
import {findPath,floodDistances} from './navigation.mjs';

export function planStrengthPath({world,grid,start,target,boulders,smashable=[],blockers=new Set(),maxStates=2000}){
 const nodes=[{start,boulders,smashable,parent:null,steps:[],depth:0}],seen=new Set(),rules={...world.rules,canSurf:false};
 const tile=(x,y)=>world.tile(grid,x,y),isGoal=t=>t.x===target.x&&t.y===target.y;
 let expanded=0;
 while(nodes.length&&expanded<maxStates){
  const node=nodes.shift(),occupied=new Set([...blockers,...node.boulders.map(b=>`${b.x},${b.y}`),...node.smashable.map(b=>`${b.x},${b.y}`)]);
  const reachable=floodDistances({world,grid,start:node.start,blockers:occupied});
  const component=[...reachable.keys()].sort().join(';');
  const key=`${component}:${node.boulders.map(b=>`${b.x},${b.y}`).sort().join(';')}:${node.smashable.map(b=>b.localId).join(',')}`;
  if(seen.has(key))continue;seen.add(key);expanded++;
  const path=findPath({world,grid,start:node.start,isGoal,blockers:occupied});
  if(path){const chunks=[path];for(let n=node;n.parent;n=n.parent)chunks.push(n.steps);return chunks.reverse().flat();}
  const enqueue=next=>{
   next.depth=node.depth+1;
   // Large puzzles need useful openings before unrelated permutations. The
   // entire solution is still verified before its first push is executed.
   next.priority=boulders.length<6?next.depth:next.depth+8*(Math.abs(next.start.x-target.x)+Math.abs(next.start.y-target.y));
   let lo=0,hi=nodes.length;while(lo<hi){const mid=(lo+hi)>>1;if((nodes[mid].priority??0)<=next.priority)lo=mid+1;else hi=mid;}nodes.splice(lo,0,next);
  };
  for(const rock of node.smashable)for(const direction of ['up','down','left','right']){
   const {dx,dy}=DELTA[direction],stand={x:rock.x-dx,y:rock.y-dy};
   if(!reachable.has(`${stand.x},${stand.y}`))continue;
   const approach=findPath({world,grid,start:node.start,isGoal:t=>t.x===stand.x&&t.y===stand.y,blockers:occupied});
   if(!approach)continue;
   enqueue({start:{...stand,elevation:tile(stand.x,stand.y).elevation},boulders:node.boulders,smashable:node.smashable.filter(r=>r!==rock),parent:node,steps:[...approach,{...stand,direction,smash:{x:rock.x,y:rock.y,localId:rock.localId}}]});
  }
  for(let i=0;i<node.boulders.length;i++)for(const direction of ['up','down','left','right']){
   const boulder=node.boulders[i],{dx,dy}=DELTA[direction],stand={x:boulder.x-dx,y:boulder.y-dy},to=tile(boulder.x+dx,boulder.y+dy),from=tile(boulder.x,boulder.y);
   if(!reachable.has(`${stand.x},${stand.y}`)||!canStep(rules,from,to,direction,boulder.elevation??from.elevation,occupied,{allowDoors:false}))continue;
   // NPC boulders cannot use a player's jump, Surf, warp or forced movement.
   if(rules.water.has(to.behavior)||Object.values(rules.jumps).includes(to.behavior)||rules.stepWarps?.has(to.behavior)||rules.forced?.has(to.behavior)||Object.values(rules.arrowWarps??{}).includes(to.behavior))continue;
   const approach=findPath({world,grid,start:node.start,isGoal:t=>t.x===stand.x&&t.y===stand.y,blockers:occupied});
   if(!approach)continue;
   const next=[...node.boulders];next[i]={...boulder,x:to.x,y:to.y,elevation:nextElevation(boulder.elevation??from.elevation,to)};
   const step={x:boulder.x,y:boulder.y,direction,push:{from:{x:boulder.x,y:boulder.y},to:{x:to.x,y:to.y},localId:boulder.localId}};
   enqueue({start:{x:boulder.x,y:boulder.y,elevation:from.elevation},boulders:next,smashable:node.smashable,parent:node,steps:[...approach,step]});
  }
 }
 return null;
}
