// Scripted movement barriers supplement the cartridge's collision grid.
export function routeRestrictions(constants,observation){
 const result=new Map();
 if(!(observation.bag?.keyItems??[]).some(item=>item.itemId===constants.items.ITEM_GO_GOGGLES&&item.quantity>0)){
  const route=constants.maps.get('MAP_ROUTE111');
  if(route)result.set(`${route.group}:${route.number}`,new Set(route.coordEvents.filter(event=>event.script?.startsWith('Route111_EventScript_ViciousSandstormTrigger')).map(event=>`${event.x},${event.y}`)));
 }
 return result;
}

export function adjacentFieldObstacle(constants,o){
 if(!o.fieldReady)return null;
 const map=constants.maps.get(o.player.map.id),here=o.player.position;
 for(const object of o.objects){
  if(object.isPlayer||object.invisible||object.mapGroup!==map?.group||object.mapNum!==map?.number||Math.abs(object.x-here.x)+Math.abs(object.y-here.y)!==1)continue;
  const template=map.objects.find(p=>p.localId===object.localId&&constants.graphics[p.graphicsId]===object.graphicsId);
  const method=template?.script?.includes('RockSmash')?{move:249,badge:'FLAG_BADGE03_GET'}:template?.script?.includes('CutTree')?{move:15,badge:'FLAG_BADGE01_GET'}:null;
  if(method&&o.flag(method.badge)&&o.party.some(p=>p.validity==='valid'&&!p.isEgg&&p.moves.some(m=>m.id===method.move)))return {kind:'interact',map:map.id,x:object.x,y:object.y,localId:object.localId};
 }
 return null;
}

export function fieldTravelWorld(world,o){
 const canSurf=o.flag('FLAG_BADGE05_GET')&&o.party.some(p=>p.validity==='valid'&&!p.isEgg&&p.moves.some(m=>m.id===57));
 const canDive=o.flag('FLAG_BADGE07_GET')&&o.party.some(p=>p.validity==='valid'&&!p.isEgg&&p.moves.some(m=>m.id===291));
 const canWaterfall=o.flag('FLAG_BADGE08_GET')&&o.party.some(p=>p.validity==='valid'&&!p.isEgg&&p.moves.some(m=>m.id===127));
 const geometry=(group,number)=>{
  const original=world.geometry(group,number);
  const layout=original.id==='MAP_ROUTE131'?'LAYOUT_ROUTE131_SKY_PILLAR':o.var?.('VAR_SKY_PILLAR_STATE')<2&&/^MAP_SKY_PILLAR_([1-5]F|TOP)$/.test(original.id)?original.id.replace('MAP_','LAYOUT_')+'_CLEAN':null;
  return layout?world.geometry(group,number,layout):original;
 };
 return {...world,geometry,rules:{...world.rules,canSurf,canDive,canWaterfall}};
}
