// rotating_tile_puzzle.c moves every saved object template on the chosen
// color's arrow, including objects outside the active sprite window.
import {DELTA,OPPOSITE,canStep} from './world.mjs';
import {findPath,floodDistances} from './navigation.mjs';

export function decodePuzzleObjects(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),objects=[];
 for(let offset=0;offset+24<=bytes.length;offset+=24){
  const localId=bytes[offset];if(!localId)continue;
  objects.push({localId,graphicsId:bytes[offset+1],x:view.getInt16(offset+4,true),y:view.getInt16(offset+6,true),elevation:bytes[offset+8],flagId:view.getUint16(offset+20,true)});
 }
 return objects;
}

export function planRotatingTilePath({world,grid,start,target,objects,switches,warps,maxStates=12000}){
 const terminalCoords=new Set([...switches,...warps].map(p=>`${p.x},${p.y}`));
 const walking={...world,rules:{...world.rules,terminalCoords}},nodes=[{start,objects,parent:null,steps:[]}],seen=new Set();
 const tile=(x,y)=>world.tile(grid,x,y),same=(a,b)=>a.x===b.x&&a.y===b.y;
 const pathTo=(node,goal,blockers)=>{
  const path=findPath({world:walking,grid,start:node.start,isGoal:t=>same(t,goal),blockers});
  if(path?.length||!path||!same(node.start,goal))return path;
  const here=tile(goal.x,goal.y);
  for(const direction of ['up','down','left','right']){
   const {dx,dy}=DELTA[direction],to=tile(goal.x+dx,goal.y+dy);
   if(!to||terminalCoords.has(`${to.x},${to.y}`)||walking.rules.doors.has(to.behavior))continue;
   if(canStep(walking.rules,here,to,direction,node.start.elevation??here.elevation,blockers)&&canStep(walking.rules,to,here,OPPOSITE[direction],to.elevation,blockers))return [{x:to.x,y:to.y,direction},{x:goal.x,y:goal.y,direction:OPPOSITE[direction]}];
  }
  return null;
 };
 for(let head=0;head<nodes.length&&head<maxStates;head++){
  const node=nodes[head],blockers=new Set(node.objects.map(p=>`${p.x},${p.y}`));
  const reachable=floodDistances({world:walking,grid,start:node.start,blockers});
  // An arrival on a switch can leave on either side. It must not collapse
  // into a nearby component that could only approach that switch.
  const key=`${node.start.x},${node.start.y},${node.start.elevation}:`+node.objects.map(p=>`${p.x},${p.y}`).join(';');
  if(seen.has(key))continue;seen.add(key);
  if(reachable.has(`${target.x},${target.y}`)){
   const last=findPath({world:walking,grid,start:node.start,isGoal:t=>same(t,target),blockers});
   if(last){const chunks=[last];for(let n=node;n.parent;n=n.parent)chunks.push(n.steps);return chunks.reverse().flat();}
  }
  for(const event of [...switches,...warps]){
   if(!reachable.has(`${event.x},${event.y}`))continue;
   const path=pathTo(node,event,blockers);if(!path?.length)continue;
   let nextObjects=node.objects,nextStart;
   if(event.color!==undefined){
    nextObjects=node.objects.map(p=>{
     const metatile=tile(p.x,p.y)?.metatile,offset=metatile-0x250,arrow=offset%8;
     if(offset<0||Math.floor(offset/8)!==event.color||arrow>3)return p;
     const {dx,dy}=DELTA[['right','down','left','up'][arrow]];return {...p,x:p.x+dx,y:p.y+dy};
    });
    nextStart={x:event.x,y:event.y,elevation:tile(event.x,event.y).elevation};
   }else nextStart={...event.destination,elevation:tile(event.destination.x,event.destination.y)?.elevation};
   const steps=[...path.slice(0,-1),{...path.at(-1),...(event.color!==undefined?{switch:event.color}:{warp:true})}];
   nodes.push({start:nextStart,objects:nextObjects,parent:node,steps});
  }
 }
 return null;
}
