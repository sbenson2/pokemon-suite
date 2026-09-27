// Native Emerald fishing: decompilation algorithm, original ROM save layout.
const u16=b=>b[0]|b[1]<<8,u32=b=>(b[0]|b[1]<<8|b[2]<<16|b[3]<<24)>>>0;
export function readFeebasSeed(read,manifest){
 const save1=u32(read(manifest.gSaveBlock1Ptr,4));
 if(save1<0x02000000||save1+0x2e6c>0x02040000)throw Error('The native Emerald Feebas seed is unavailable.');
 // CheckFeebas at 0x080b4a0c loads literal 0x2e6a from 0x080b4a90.
 // Original compiler layout differs from the current struct/comment offset.
 return u16(read(save1+0x2e6a,2));
}
export function feebasSpotIds(seed){
 if(!Number.isInteger(seed)||seed<0||seed>65535)throw Error('Invalid native Feebas seed.');
 const result=[];while(result.length<6){seed=(Math.imul(seed,1103515245)+12345)>>>0;const id=(seed>>>16)%447||447;if(id>=4)result.push(id);}
 return result;
}
export function nativeFeebasSpots({read,manifest,world,constants}){
 const seed=readFeebasSeed(read,manifest),wanted=feebasSpotIds(seed),map=constants.maps.get('MAP_ROUTE119'),grid=world.geometry(map.group,map.number),spots=[];let id=0;
 for(let y=0;y<grid.height;y++)for(let x=0;x<grid.width;x++){
  const tile=world.tile(grid,x,y);if(!world.rules.surfable.has(tile.behavior)||world.rules.waterfalls.has(tile.behavior))continue;id++;
  if(wanted.includes(id))for(const [facing,dx,dy] of [['up',0,1],['down',0,-1],['left',1,0],['right',-1,0]]){
   const stand=world.tile(grid,x+dx,y+dy);if(stand&&stand.collision===0&&!world.rules.waterfalls.has(stand.behavior))spots.push({map:map.id,x:x+dx,y:y+dy,facing,spotId:id,water:world.rules.water.has(stand.behavior)});
  }
 }
 if(id!==447)throw Error('The native Route 119 fishing map disagrees with its verified 447 spots.');
 return {seed,spots:spots.sort((a,b)=>Number(a.water)-Number(b.water)||b.y-a.y)};
}
export function fishingButtons(step,lastA){return [7,10,13,15].includes(step)&&!lastA?['a']:[];}
