import {buildPokeBallMartCatalog,campaignNavigationRecommendation,selectRecoveryObjective} from '../player/campaign.js';
import {nextRecoveryTreatment,partyFullyRestored,hasUsableAttackingPp,hasAttackingMove} from '../player/recovery.js';
import {fireRedPokemonCenter} from './fire-red-link-quest.js';

const CATALOGS=new WeakMap();
const PRICES={2:1200,3:600,19:3000,20:2500,23:600,24:1500,84:700};
const CENTER='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';
const count=(m,id)=>Object.values(m.trainer?.bag??{}).flat().filter(i=>i.itemId===id).reduce((n,i)=>n+i.quantity,0);
const free=o=>o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&o.emulator.inputReady!==false&&
 !o.emulator.paletteFadeActive&&!o.playerMemory.scripts?.fieldControlsLocked&&
 (!o.playerMemory.scripts?.globalStatus||o.playerMemory.scripts.globalStatus==='shutdown')&&
 (!o.playerMemory.scripts?.globalMode||o.playerMemory.scripts.globalMode==='stopped')&&
 !Object.values(o.playerMemory.ui??{}).some(Boolean);
const objective=(id,target)=>({id,target,taskKind:'recovery',dialogue:'advance',choice:'yes',deferOptionalDetours:true});
const basketComplete=(shop,m)=>shop.objective.target.items.every(i=>count(m,i.itemId)>=i.quantity);
const basketRemaining=(shop,m)=>shop.objective.target.items.reduce((total,i)=>total+Math.max(0,i.quantity-count(m,i.itemId))*i.unitPrice,0);
const basketSpent=shop=>Number.isSafeInteger(shop.observedSpent)?shop.observedSpent:shop.cost+(shop.extraCost??0);
function basketBudgetStop(shop,m,state,maxSpend){
 const remaining=basketRemaining(shop,m);
 const projected=Number.isSafeInteger(shop.observedSpent)?Math.max(shop.cost+(shop.extraCost??0),shop.observedSpent+remaining):shop.cost+(shop.extraCost??0);
 return remaining>m.trainer.money-10000||projected>Math.min(maxSpend,shop.spendingLimit??Infinity)-(state.spent??0)
  ?objective('postgame-supply-budget',{kind:'stop-for-review',reason:'The retained supply basket exceeds the remaining spending limit or cash reserve.'}):null;
}
// A basket is priced from the stock and money of the moment it is planned. Its
// absolute targets go stale when its own items are used before it buys
// anything: capture balls thrown on the way (National Dex captures during the
// trip) or medicine used for care raise what the same targets cost. Such a
// basket is re-derived from the current stock and money within the same cash
// reserve and spending limit, at its retained destination. Once anything was
// spent (or without a spending ledger) a shortfall still stops for review, as
// does a re-derivation that finds no purchase within the limits.
function replanStaleBasket(shop,o,{world,story,state,maxSpend}){
 const m=o.playerMemory,target=shop.objective?.target;
 // observedSpent proves nothing was bought only while lastObservedMoney tracks the balance.
 if(shop.observedSpent!==0||!Number.isSafeInteger(shop.lastObservedMoney)||target?.kind!=='purchase-items'||!story)return false;
 const mart=martCatalog(world,story).find(entry=>entry.map===target.map&&entry.objectIndex===target.objectIndex);
 const cap=Math.min(maxSpend,shop.spendingLimit??Infinity);
 const plan=mart?planBasket(m,mart,Math.floor(Math.min(m.trainer.money-10000,cap-(state.spent??0)))):null;
 if(!plan)return false;
 Object.assign(shop,{cost:plan.cost,spendingLimit:Number.isFinite(cap)?cap:null,replanned:(shop.replanned??0)+1,
  objective:{...shop.objective,target:{...target,items:plan.items}}});
 delete shop.extraCost;
 return true;
}
const retainedBasketStop=(shop,o,context)=>{
 const stop=basketBudgetStop(shop,o.playerMemory,context.state,context.maxSpend);
 return stop&&!replanStaleBasket(shop,o,context)?stop:null;
};
function observeBasket(shop,m){
 const money=m.trainer?.money;
 if(Number.isSafeInteger(money)&&Number.isSafeInteger(shop.lastObservedMoney)){
  shop.observedSpent=(shop.observedSpent??0)+Math.max(0,shop.lastObservedMoney-money);
  shop.lastObservedMoney=money;
 }
 if(shop.careCounts){
  for(const item of shop.objective.target.items){
   const previous=shop.careCounts[item.itemId],current=count(m,item.itemId);
   if(Number.isSafeInteger(previous)&&current<previous)shop.extraCost=(shop.extraCost??0)+(previous-current)*item.unitPrice;
   shop.careCounts[item.itemId]=current;
  }
 }
}
const readyAttackers=(m,mechanics)=>m.trainer.party.filter(p=>p.hp>0&&p.maxHp>0&&p.hp/p.maxHp>0.65&&
 !p.status1&&hasUsableAttackingPp(p,mechanics)).length;
const needsCenter=(m,mechanics,shop=null)=>{
 const party=m.trainer.party;
 const ready=readyAttackers(m,mechanics);
 const deferParalysis=shop?.objective?.target?.map===CENTER&&ready>=2;
 return party.some(p=>p.hp<=0||p.maxHp>0&&p.hp/p.maxHp<=0.65||
  hasAttackingMove(p,mechanics)&&!hasUsableAttackingPp(p,mechanics)||
  p.status1&&!(deferParalysis&&p.status1===0x40));
};
function basketCenterNurse(o,world,mechanics,shop){
 const map=shop?.objective?.target?.kind==='purchase-items'?shop.objective.target.map:null;
 if(!map||readyAttackers(o.playerMemory,mechanics)<2)return null;
 const index=(world?.data??world)?.maps?.find(entry=>entry.id===map)?.objectEvents?.findIndex(event=>/EventScript_Nurse$/.test(event.script));
 if(!(index>=0))return null;
 const selected=objective('restore-postgame-party',{kind:'object',map,index});
 const recommendation=campaignNavigationRecommendation({world,observation:o,objective:selected});
 return recommendation&&recommendation.kind!=='wait-for-supported-objective'?selected:null;
}

function martCatalog(world,story){
 let catalog=CATALOGS.get(story);if(!catalog){catalog=buildPokeBallMartCatalog(world,story);CATALOGS.set(story,catalog);}
 return catalog;
}
function shopping(o,world,story,state,maxSpend){
 const m=o.playerMemory,money=m.trainer?.money;
 if(!story||!Number.isSafeInteger(money)||!m.trainer?.bag)return null;
 const hp=[19,20,21].reduce((n,id)=>n+count(m,id),0);
 if(hp>=5&&count(m,24)>=3&&count(m,23)+count(m,19)>=5&&count(m,2)>=30&&count(m,84)>=3)return null;
 const budget=Math.floor(Math.min(money-10000,maxSpend-(state.spent??0)));if(!(budget>0))return null;
 // The League's verified clerk stocks the complete medicine basket in one visit.
 const mart=martCatalog(world,story).find(m=>m.map===CENTER);if(!mart)return null;
 const plan=planBasket(m,mart,budget);if(!plan)return null;
 return {kind:'shop',cost:plan.cost,spendingLimit:Number.isFinite(maxSpend)?maxSpend:null,startingMoney:money,lastObservedMoney:money,observedSpent:0,objective:objective('stock-postgame-supplies',{kind:'purchase-items',map:mart.map,objectIndex:mart.objectIndex,items:plan.items})};
}
// Absolute targets from the current bag, funded in priority order within budget.
function planBasket(m,mart,budget){
 if(!(budget>0)||!m.trainer?.bag)return null;
 const stock=new Map(mart.stock.map(i=>[i.itemId,i])),items=new Map();
 const slots={items:(m.trainer.bag.items??[]).length,pokeBalls:(m.trainer.bag.pokeBalls??[]).length};
 const capacities={items:42,pokeBalls:13};
 const add=(id,target)=>{
  if(!stock.has(id))return;
  const owned=count(m,id),selected=items.get(id)?.quantity??owned,pocket=id<=12?'pokeBalls':'items';
  if(!owned&&!items.has(id)&&slots[pocket]>=capacities[pocket])return;
  const amount=Math.min(target-selected,Math.floor(budget/PRICES[id]),999-selected);
  if(!(amount>0))return;
  if(!owned&&!items.has(id))slots[pocket]++;
  items.set(id,{itemId:id,quantity:selected+amount,stockIndex:stock.get(id).stockIndex,unitPrice:PRICES[id]});budget-=amount*PRICES[id];
 };
 // Fund minimum essentials across categories before filling the larger reserves.
 for(const [id,target] of [[2,30],[20,5],[24,5],[23,5],[20,20],[19,10],[23,15],[24,20],[84,20],[2,99],[3,30]])add(id,target);
 if(!items.size)return null;
 const wanted=[...items.values()];
 return {items:wanted,cost:wanted.reduce((n,i)=>n+(i.quantity-count(m,i.itemId))*i.unitPrice,0)};
}

export function postgameCareObjective(o,{world,story,mechanics,state,maxSpend=Infinity,stockSupplies=true}){
 const m=o.playerMemory;
 if(state.active?.kind==='shop')observeBasket(state.active,m);
 if(state.suspendedShopping)observeBasket(state.suspendedShopping,m);
 if(o.emulator.inBattle||m.ui?.saveDialog)return null;
 if(state.active){
  const a=state.active;
  const done=a.kind==='shop'?basketComplete(a,m):a.kind==='items'?!nextRecoveryTreatment(m,mechanics,{travel:true}):partyFullyRestored(m,mechanics);
  if(!free(o))return a.objective;
  if(a.kind==='center'&&state.suspendedShopping&&!nextRecoveryTreatment(m,mechanics,{travel:true})&&
     !needsCenter(m,mechanics,state.suspendedShopping)){
   state.active=null;
  }else if(!done&&a.kind==='shop'&&m.trainer?.partyValidity==='valid'&&m.trainer.party?.length&&
     (nextRecoveryTreatment(m,mechanics,{travel:true})||needsCenter(m,mechanics,a))){
   a.careCounts=Object.fromEntries(a.objective.target.items.map(i=>[i.itemId,count(m,i.itemId)]));
   state.suspendedShopping=a;state.active=null;
  }else if(!done){
   if(a.kind==='center'&&!campaignNavigationRecommendation({world,observation:o,objective:a.objective})){
    const replacement=basketCenterNurse(o,world,mechanics,state.suspendedShopping)??selectRecoveryObjective({world,story,observation:o});
    if(!replacement)return objective('postgame-care-route',{kind:'stop-for-review',reason:'No executable route to a free healer is available.'});
    a.objective={...replacement,id:'restore-postgame-party',taskKind:'recovery',dialogue:'advance',choice:'yes',deferOptionalDetours:true};
   }
   return (a.kind==='shop'?retainedBasketStop(a,o,{world,story,state,maxSpend}):null)??a.objective;
  }
  else{
   if(a.kind==='shop')state.spent=(state.spent??0)+basketSpent(a);
   state.active=null;
  }
 }
 if(!free(o)||m.trainer?.partyValidity!=='valid'||!m.trainer.party?.length)return null;
 const treatment=nextRecoveryTreatment(m,mechanics,{travel:true});
 if(treatment){state.active={kind:'items',objective:objective('restore-postgame-party-with-items',{kind:'heal-with-items',travel:true})};return state.active.objective;}
 if(needsCenter(m,mechanics,state.suspendedShopping)){
  const map=fireRedPokemonCenter(m.map?.id),index=(world?.data??world)?.maps?.find(m=>m.id===map)?.objectEvents?.findIndex(e=>/EventScript_Nurse$/.test(e.script));
  const nearby=basketCenterNurse(o,world,mechanics,state.suspendedShopping)??
   selectRecoveryObjective({world,story,observation:o})??(index>=0?{target:{kind:'object',map,index}}:null);
  if(nearby){state.active={kind:'center',objective:{...nearby,id:'restore-postgame-party',taskKind:'recovery',dialogue:'advance',choice:'yes',deferOptionalDetours:true}};return state.active.objective;}
 }
 if(state.suspendedShopping){
  const shop=state.suspendedShopping;
  if(basketComplete(shop,m)){
   state.spent=(state.spent??0)+basketSpent(shop);state.suspendedShopping=null;
   return null;
  }
  const budgetStop=retainedBasketStop(shop,o,{world,story,state,maxSpend});if(budgetStop)return budgetStop;
  delete shop.careCounts;
  state.active=shop;state.suspendedShopping=null;
  return shop.objective;
 }
 if(stockSupplies&&m.storyState?.flagIds?.[2092]===true){state.active=shopping(o,world,story,state,maxSpend);return state.active?.objective??null;}
 return null;
}
