import {planBeautyFeeding,pokeblockBeautyGain} from './beauty.mjs';
const ivKeys=['hp','attack','defense','speed','spAttack','spDefense'];
export function verifyBeautyIndividual(party,source){
 const matches=party.filter(p=>p.validity==='valid'&&p.personality===source.personality&&p.otId===source.otId);
 if(matches.length!==1||ivKeys.some(k=>matches[0].ivs[k]!==source.ivs[k])||Boolean(matches[0].shiny)!==Boolean(source.shiny)||matches[0].isEgg)throw Error('The reserved Feebas identity is missing or changed.');
 if(![328,329].includes(matches[0].species))throw Error('The reserved Feebas has an unexpected species.');
 return matches[0];
}
export function planBeautyResources(o,p,c,recipes,excluded=[]){
 const feeding=planBeautyFeeding(p,o.pokeblocks);
 if(feeding.kind!=='supply')return feeding;
 if(o.pokeblocks.length>=40)return {kind:'stop',reason:'The Pokéblock Case is full without a complete Beauty plan. Preserve the individual and review the case.'};
 const candidates=[];
 for(let itemId=133;itemId<=174;itemId++){
  if([138,141,142,174].includes(itemId))continue; // Retain PP, status and healing reserves; exclude custom Enigma.
  const recipe=recipes.recipe(itemId,10000),block=recipe.block;
  if(block&&pokeblockBeautyGain(p.personality,block)>0)candidates.push({...recipe,score:pokeblockBeautyGain(p.personality,block)/Math.max(1,block.feel)});
 }
 candidates.sort((a,b)=>b.score-a.score||b.block.dry-a.block.dry);
 const inventory=[];let slot=40;
 for(const r of candidates)for(let n=0;n<Math.min(40,(o.bag.berries??[]).find(b=>b.itemId===r.itemId)?.quantity??0);n++)inventory.push({slot:slot++,...r.block,itemId:r.itemId});
 // Expected blender quality only plans travel/supplies. Actual case contents
 // must independently pass the full Sheen budget before the first feeding.
 const forecast=planBeautyFeeding(p,[...o.pokeblocks,...inventory].slice(0,40));
 if(forecast.kind==='feed'){
  const next=forecast.slots.map(slot=>inventory.find(b=>b.slot===slot)).find(Boolean);
  if(next)return {kind:'blend',itemId:next.itemId};
 }
 for(const r of candidates){
  for(const [id,map] of c.maps.byId){
   if(!/^MAP_ROUTE\d+$/.test(id))continue;
   for(const object of map.objects??[]){
    const tree=o.berryTrees?.find(t=>t.id===c.berryTreeIds[object.sightRange]);
    if(tree?.itemId===r.itemId&&tree.stage===5&&tree.yield>0&&!excluded.includes(tree.id))return {kind:'interact',map:id,x:object.x,y:object.y,localId:object.localId,treeId:tree.id,itemId:r.itemId,reason:'harvest-beauty-berries'};
   }
  }
 }
 if(inventory.length){const next=candidates.find(r=>inventory.some(b=>b.itemId===r.itemId));return {kind:'blend',itemId:next.itemId};}
 return {kind:'stop',reason:'No reachable ripe dry-flavor berries remain. The Feebas is preserved without an incomplete feeding plan.'};
}
export function planBeautyLevelUp(o,p,c){
 if(p.level>=100)return {kind:'stop',reason:'A level 100 Feebas cannot perform a native Gen III level-up evolution.'};
 if(p.heldItem===195)return {kind:'stop',reason:'Remove Feebas’s Everstone before its native evolution.'};
 if((o.bag.items??[]).some(i=>i.itemId===c.items.ITEM_RARE_CANDY&&i.quantity>0))return {kind:'level-up',itemId:c.items.ITEM_RARE_CANDY,personality:p.personality,otId:p.otId,targetSpecies:329,before:{level:p.level}};
 for(const name of ['MAP_PETALBURG_CITY','MAP_ROUTE110','MAP_ROUTE114','MAP_ROUTE119','MAP_ROUTE120','MAP_ROUTE123','MAP_ROUTE127','MAP_ROUTE111']){
  const map=c.maps.get(name),hidden=map.bgEvents.find(e=>e.item==='ITEM_RARE_CANDY'&&!o.flag(e.flag));
  if(hidden)return {kind:'interact',map:name,x:hidden.x,y:hidden.y};
  const ball=map.objects.find(e=>/ItemRareCandy$/.test(e.script??'')&&e.flag&&!o.flag(e.flag));
  if(ball)return {kind:'interact',map:name,x:ball.x,y:ball.y,localId:ball.localId};
 }
 return {kind:'stop',reason:'The verified Rare Candy pickups are exhausted. Feebas’s completed Beauty is saved; another native level-up is required.'};
}
