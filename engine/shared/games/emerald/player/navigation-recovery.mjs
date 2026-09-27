import {neutralProgram,walkProgram} from './controller.mjs';

export function routeRecoveryProgram(o,direction,constants){
 const map=o.player.map;
 const puzzle=map.id==='MAP_SOOTOPOLIS_CITY_GYM_1F'||o.objects.some(p=>!p.isPlayer&&!p.invisible&&p.mapGroup===map.group&&p.mapNum===map.number&&p.graphicsId===constants.graphics.OBJ_EVENT_GFX_PUSHABLE_BOULDER);
 return puzzle?neutralProgram(30,'preserve-unsolved-puzzle'):walkProgram(direction,{maxFrames:30,stallFrames:12,reason:'route-recovery'});
}
