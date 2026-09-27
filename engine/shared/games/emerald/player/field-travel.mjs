// A planned water path stops on land until the cartridge starts native Surf.
export function surfaceApproach({observation,world,grid,path}){
 if(observation.player.avatar.flags&(8|16))return null;
 const water=path.findIndex(step=>world.rules.water.has(world.tile(grid,step.x,step.y)?.behavior));
 return water<0?null:{path:path.slice(0,water),face:path[water].direction};
}

export function waterfallApproach({world,grid,path,start}){
 if(world.rules.waterfalls?.has(world.tile(grid,start.x,start.y)?.behavior))return null;
 const index=path.findIndex(step=>step.direction==='up'&&world.rules.waterfalls?.has(world.tile(grid,step.x,step.y)?.behavior));
 return index<0?null:{path:path.slice(0,index),face:'up'};
}
