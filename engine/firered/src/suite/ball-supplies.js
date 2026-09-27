import {captureBallMultiplier,CAPTURE_BALL_UNIT_PRICES} from '../player/capture-balls.js';
import {fireRedIsland} from './fire-red-link-quest.js';

export const FIRE_RED_SHOP_BALL_IDS=Object.freeze([2,3,4,9,10]);
export const BALL_SHOP_WATCH={flags:[669,670,671,672,675,2092,2116,2118],variables:[0x4078]};
export const BALL_SUPPLY_PROFILE='bulk-99';
const desired={2:99,3:99,4:99,9:99,10:99},low={2:50,3:50,4:50,9:50,10:50};
export function planFireRedBallSupply({observation:o,shops,budget,opponent={},mechanics={}}){
 const m=o.playerMemory,t=m.trainer,origin=fireRedIsland(m.map?.id),flags=m.storyState?.flagIds??{};
 let remaining=Math.max(0,Math.floor(Math.min(budget,t.money-10000)));
 if(!Number.isFinite(remaining)||remaining<200)return null;
 const catalog=shops.filter(s=>fireRedIsland(s.map)<=3||flags[2118]===true).map(s=>({...s,ballStock:s.ballStock.filter(b=>[2,3,4].includes(b.itemId))}));
 // These stock slots are the cartridge's final Two Island shop. The caller
 // completes its native introduction/expansion visits before buying here.
 if(flags[2116]===true)catalog.push({map:'MAP_TWO_ISLAND',objectIndex:0,ballStock:[{itemId:2,stockIndex:0},{itemId:9,stockIndex:1},{itemId:10,stockIndex:2}]});
 const ids=FIRE_RED_SHOP_BALL_IDS.filter(id=>catalog.some(s=>s.ballStock.some(b=>b.itemId===id)));
 const owned=id=>(t.bag?.pokeBalls??[]).filter(b=>b.itemId===id).reduce((n,b)=>n+b.quantity,0);
 if(!ids.some(id=>owned(id)<low[id]))return null;
 const quantities=Object.fromEntries(ids.map(id=>[id,owned(id)])),initial=remaining;
 const ranked=[...ids].sort((a,b)=>captureBallMultiplier({itemId:b,opponent,mechanics,ownedSpecies:t.pokedex?.ownedSpecies})-captureBallMultiplier({itemId:a,opponent,mechanics,ownedSpecies:t.pokedex?.ownedSpecies})||a-b);
 const buy=id=>{const price=CAPTURE_BALL_UNIT_PRICES[id];if(remaining<price||quantities[id]>=desired[id])return false;quantities[id]++;remaining-=price;return true;};
 for(const id of ranked)if(!quantities[id])buy(id);
 // Keep the premium types broadly stocked. Cheap balls are a later top-up,
 // never a sink for the cash needed to build Ultra/Repeat/Timer reserves.
 const premium=ranked.filter(id=>[2,9,10].includes(id));
 for(let n=0;n<297;n++){
  const id=[...premium].sort((a,b)=>quantities[a]-quantities[b]).find(id=>quantities[id]<99&&remaining>=CAPTURE_BALL_UNIT_PRICES[id]);
  if(id===undefined)break;buy(id);
 }
 if(premium.every(id=>quantities[id]>=99))for(const id of [3,4])if(ids.includes(id))while(buy(id)){}
 const pending=new Set(ids.filter(id=>quantities[id]>owned(id))),steps=[];
 while(pending.size){
  const score=s=>100*s.ballStock.filter(b=>pending.has(b.itemId)).length+(s.map===m.map?.id?30:fireRedIsland(s.map)===origin?20:0)+(s.map.endsWith('_MART')?1:0);
  const shop=catalog.filter(s=>s.ballStock.some(b=>pending.has(b.itemId))).sort((a,b)=>score(b)-score(a))[0];
  const items=shop.ballStock.filter(b=>pending.has(b.itemId)).map(b=>({itemId:b.itemId,stockIndex:b.stockIndex,quantity:quantities[b.itemId],unitPrice:CAPTURE_BALL_UNIT_PRICES[b.itemId]}));
  items.forEach(b=>pending.delete(b.itemId));steps.push({map:shop.map,objectIndex:shop.objectIndex,items});
 }
 return steps.length?{schema:'pokemon-suite/ball-supply/v1',profile:BALL_SUPPLY_PROFILE,steps,index:0,cost:initial-remaining,cashReserve:10000,completed:false}:null;
}

export function fireRedBallShopUpgrade(o){
 const m=o.playerMemory,flags=m.storyState?.flagIds??{},ui=m.ui??{};
 if(flags[2116]!==true)return null;
 const goal=target=>({kind:'policy',objective:{id:'expand-two-island-ball-shop',target,dialogue:'advance',deferOptionalDetours:true}});
 if(m.map?.id!=='MAP_TWO_ISLAND')return goal({kind:'map',map:'MAP_TWO_ISLAND'});
 if(m.storyState?.variableIds?.[0x4078]===4)return null;
 if(ui.mart)return {kind:'recommendation',recommendation:{kind:'close-menu'}};
 if(ui.fieldDialog)return {kind:'recommendation',recommendation:{kind:'acknowledge-cartridge-prompt'}};
 if(ui.startMenu||ui.bag||ui.party)return {kind:'recommendation',recommendation:{kind:'close-menu'}};
 const stage=!flags[669]?1:!flags[670]?2:!flags[671]?3:4;
 if(m.storyState?.variableIds?.[0x4078]!==stage)return goal({kind:'map',map:'MAP_TWO_ISLAND_CAPE_BRINK'});
 return goal({kind:'object',map:'MAP_TWO_ISLAND',index:0});
}
