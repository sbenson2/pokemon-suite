export const inLeague=o=>/^MAP_EVER_GRANDE_CITY_(SIDNEYS_ROOM|PHOEBES_ROOM|GLACIAS_ROOM|DRAKES_ROOM|CHAMPIONS_ROOM|HALL[1-5]|HALL_OF_FAME)$/.test(o.player?.map.id);
const wait=reason=>({kind:'wait',reason});

export function leaguePpStock(o,c){
 const amount=(o.bag.berries??[]).filter(i=>i.itemId===c.items.ITEM_LEPPA_BERRY).reduce((n,i)=>n+i.quantity,0);
 if(amount>=4)return null;
 // Read live tree state before approaching: empty soil would offer to plant
 // one of the reserves instead of supplying PP recovery.
 for(const name of ['MAP_ROUTE123','MAP_ROUTE119','MAP_ROUTE103','MAP_ROUTE104'])for(const p of c.maps.get(name).objects){
  const tree=o.berryTrees?.find(t=>t.id===c.berryTreeIds[p.sightRange]);
  if(tree?.itemId===c.items.ITEM_LEPPA_BERRY&&tree.stage===5&&tree.yield>0)return {kind:'interact',map:name,x:p.x,y:p.y,localId:p.localId};
 }
 return wait('League preparation needs four Leppa Berries; no currently ripe source remains.');
}

export function leagueRecovery(o,c){
 const stock=(pocket,names)=>names.map(name=>c.items[name]).find(id=>(o.bag[pocket]??[]).some(i=>i.itemId===id&&i.quantity>0));
 const restore=(p,itemId,pocket='items',move=null)=>({kind:'restore',personality:p.personality,otId:p.otId,itemId,pocket,before:{hp:p.hp,status:p.status,...(move?{pp:move.pp}:{})},...(move?{restoreMoveId:move.id}:{})});
 const party=o.party.filter(p=>p.validity==='valid'&&!p.isEgg);
 for(const p of party){
  if(p.hp===0){const item=stock('items',['ITEM_MAX_REVIVE','ITEM_REVIVE']);return item?restore(p,item):wait('The next League battle needs a Revive for the fainted party member.');}
  if(p.hp<p.maxHp||p.status){
   const item=stock('items',p.status?['ITEM_FULL_RESTORE','ITEM_FULL_HEAL']:['ITEM_MAX_POTION','ITEM_FULL_RESTORE','ITEM_HYPER_POTION','ITEM_SUPER_POTION','ITEM_POTION']);
   return item?restore(p,item):wait('The next League battle needs healing supplies.');
  }
 }
 const lead=party[0],primary=lead?.moves.filter(m=>m.power>0).sort((a,b)=>b.power*(lead.types?.includes(b.type)?1.5:1)-a.power*(lead.types?.includes(a.type)?1.5:1))[0];
 if(primary&&primary.pp<8){
  const berry=stock('berries',['ITEM_LEPPA_BERRY']);if(berry)return restore(lead,berry,'berries',primary);
  const item=stock('items',['ITEM_MAX_ETHER','ITEM_ETHER','ITEM_MAX_ELIXIR','ITEM_ELIXIR']);
  return item?restore(lead,item,'items',primary):wait('The next League battle needs PP recovery for the primary attack.');
 }
 return null;
}
