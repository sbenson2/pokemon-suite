// Native rotating_gate.c collision and sweep rules. Gate data comes from the
// installed cartridge; orientations are read from its VAR_TEMP_0 bytes.
import {canStep,DELTA,nextElevation} from './world.mjs';

export function readGateTables({readMemory,manifest}){
 const read=(name,n)=>readMemory(manifest[name],n),s8=x=>(x<<24)>>24,s16=(b,i)=>((b[i]|b[i+1]<<8)<<16)>>16;
 const config=read('sRotatingGate_FortreePuzzleConfig',64),arms=read('sRotatingGate_ArmLayout',96);
 const coords=name=>{const b=read(name,32);return Array.from({length:8},(_,i)=>[s8(b[i*4]),s8(b[i*4+1])]);};
 return {config:Array.from({length:8},(_,i)=>({x:s16(config,i*8),y:s16(config,i*8+2),shape:config[i*8+4],orientation:config[i*8+5]})),arms:Array.from({length:12},(_,i)=>Array.from(arms.slice(i*8,i*8+8))),rotation:Object.fromEntries([['up','North'],['down','South'],['left','West'],['right','East']].map(([d,n])=>[d,Array.from(read(`sRotatingGate_RotationInfo${n}`,16))])),clockwise:coords('sRotatingGate_ArmPositionsClockwiseRotation'),anticlockwise:coords('sRotatingGate_ArmPositionsAntiClockwiseRotation')};
}

export function planGatePath({world,grid,data,orientations,start,target,blockers=null,maxStates=100000}){
 const nodes=[{...start,orientations,parent:null,direction:null}],seen=new Set();
 const tile=(x,y)=>world.tile(grid,x,y);
 for(let head=0;head<nodes.length&&head<maxStates;head++){
  const node=nodes[head],key=`${node.x},${node.y},${node.elevation}:${node.orientations.join('')}`;
  if(seen.has(key))continue;seen.add(key);
  if(node.x===target.x&&node.y===target.y){
   const path=[];for(let n=node;n.parent;n=n.parent)path.push({x:n.x,y:n.y,direction:n.direction,orientations:n.orientations});return path.reverse();
  }
  const from=tile(node.x,node.y);
  for(const direction of ['up','down','left','right']){
   const {dx,dy}=DELTA[direction],x=node.x+dx,y=node.y+dy,to=tile(x,y);
   if(!canStep(world.rules,from,to,direction,node.elevation,blockers))continue;
   const next=rotateGatesForStep({data,orientations:node.orientations,x,y,direction,tile});
   if(next)nodes.push({x,y,elevation:nextElevation(node.elevation,to),orientations:next,parent:node,direction});
  }
 }
 return null;
}

export function rotateGatesForStep({data,orientations,x,y,direction,tile}){
 for(let i=0;i<data.config.length;i++){
  const gate=data.config[i],dx=x-gate.x+2,dy=y-gate.y+2;
  if(dx<0||dy<0||dx>3||dy>3)continue;
  const info=data.rotation[direction]?.[dy*4+dx]??255;
  if(info===255)continue;
  const arm=(info&15)>>1,long=info&1,orientation=orientations[i],layout=data.arms[gate.shape];
  if(!layout[((arm-orientation+4)%4)*2+long])continue;
  const rotation=info>>4,sweep=rotation===1?data.anticlockwise:data.clockwise;
  for(let arm=0;arm<4;arm++)for(let length=0;length<2;length++){
   if(!layout[arm*2+length])continue;
   const [sx,sy]=sweep[((orientation+arm)%4)*2+length];
   if(tile(gate.x+sx,gate.y+sy)?.collision===1)return null;
  }
  const next=[...orientations];next[i]=(orientation+(rotation===1?3:1))%4;return next;
 }
 return orientations;
}
