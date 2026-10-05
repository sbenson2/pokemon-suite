// Six Island Ruin Valley's Sun Stone, the cartridge's only one: an item ball
// walled by three Strength boulders (pret pokefirered c75f3523
// data/maps/SixIsland_RuinValley/map.json: boulders 11 (41,32), 12 (41,33),
// 13 (42,33); the ball is object 16 at (43,32),
// SixIsland_RuinValley_EventScript_ItemSunStone,
// FLAG_HIDE_SIX_ISLAND_RUIN_VALLEY_SUN_STONE 0x1E6). The pocket opens only to
// the west. Pushing 11 east, 12 south, 13 east, then 11 north frees (42,32)
// beside the ball, and the last push leaves the player standing there. Every
// other order walls the pocket.
export const RUIN_VALLEY='MAP_SIX_ISLAND_RUIN_VALLEY';
// The valley's only connection; leaving and re-entering restores the boulders.
export const RUIN_VALLEY_EXIT='MAP_SIX_ISLAND_WATER_PATH';
export const SUN_STONE=Object.freeze({itemId:93,flagId:486,objectIndex:16});
// The cell west of boulder 11 the first push is made from.
export const RUIN_VALLEY_APPROACH=Object.freeze({x:40,y:32});
const at=(x,y)=>Object.freeze({x,y});
export const RUIN_VALLEY_PUSHES=Object.freeze([
 Object.freeze({index:11,from:at(41,32),to:at(42,32)}),
 Object.freeze({index:12,from:at(41,33),to:at(41,34)}),
 Object.freeze({index:13,from:at(42,33),to:at(43,33)}),
 Object.freeze({index:11,from:at(42,32),to:at(42,31)}),
]);
const BOULDERS=[11,12,13];
// The boulder layout before each push, then the solved layout after the last.
const LAYOUTS=RUIN_VALLEY_PUSHES.reduce((list,push)=>[...list,{...list.at(-1),[push.index]:push.to}],[{11:at(41,32),12:at(41,33),13:at(42,33)}]);
const same=(a,b)=>Number(a?.x)===b.x&&Number(a?.y)===b.y;

// The next step from a stable field observation. Every push is chosen from the
// live boulders, so a restart, battle or save resumes the same puzzle, and no
// elapsed push is assumed:
// - {kind:'reach'} off the valley; {kind:'read'} until all three boulders are live
//   (objects far from the camera are not spawned);
// - {kind:'push',step,push} along the reviewed order;
// - {kind:'collect',target,completion} once (42,32) is open;
// - {kind:'reset',map} for any other layout: the map reload restores the boulders.
export function ruinValleySunStoneStep(o){
 const m=o?.playerMemory??{};
 if(m.map?.id!==RUIN_VALLEY)return {kind:'reach',map:RUIN_VALLEY};
 const live=index=>(m.objectEvents??[]).find(e=>!e.player&&Number(e.localId)===index+1)?.current;
 const positions=Object.fromEntries(BOULDERS.map(index=>[index,live(index)]));
 if(BOULDERS.some(index=>!Number.isSafeInteger(Number(positions[index]?.x))||!Number.isSafeInteger(Number(positions[index]?.y))))return {kind:'read'};
 const step=LAYOUTS.findIndex(layout=>BOULDERS.every(index=>same(positions[index],layout[index])));
 if(step<0)return {kind:'reset',map:RUIN_VALLEY_EXIT};
 if(step===RUIN_VALLEY_PUSHES.length)
  return {kind:'collect',target:{kind:'object',map:RUIN_VALLEY,index:SUN_STONE.objectIndex},completion:{kind:'flag-set',id:SUN_STONE.flagId}};
 return {kind:'push',step,push:RUIN_VALLEY_PUSHES[step]};
}
