import {buildPokeBallMartCatalog} from '../player/campaign.js';
import {PostgameAgenda,postgameFailureContext} from './postgame-agenda.js';

const free=o=>o.phase==='stable'&&o.emulator?.mode==='overworld'&&!o.emulator.inBattle&&!o.playerMemory?.scripts?.fieldControlsLocked&&!Object.values(o.playerMemory?.ui??{}).some(Boolean);
const quantity=(o,id)=>Object.values(o.playerMemory.trainer?.bag??{}).flat().filter(i=>i.itemId===id).reduce((n,i)=>n+i.quantity,0);
const eligible=(failure,o,now)=>!failure||failure.retryAt<=now&&(!failure.requiresStateChange||failure.context!==postgameFailureContext(o));

function alternative(o,{world,story,planner,state,task,now}){
 const remaining=task.objective.target.items.filter(i=>quantity(o,i.itemId)<i.quantity);
 if(!remaining.length)return null;
 const candidates=[];
 for(const mart of buildPokeBallMartCatalog(world,story)){
  if(!eligible(state.routeFailures?.[mart.map],o,now)||!remaining.every(i=>mart.stock.some(s=>s.itemId===i.itemId)))continue;
  const metrics=planner.routeMetrics(o,mart.target);
  if(metrics)candidates.push({mart,metrics});
 }
 candidates.sort((a,b)=>a.metrics.transitions-b.metrics.transitions||a.metrics.localSteps-b.metrics.localSteps||a.mart.map.localeCompare(b.mart.map)||a.mart.objectIndex-b.mart.objectIndex);
 const mart=candidates[0]?.mart;if(!mart)return null;
 const target=task.objective.target;
 return {...task.objective,target:{...target,map:mart.map,objectIndex:mart.objectIndex,
  items:target.items.map(i=>({...i,stockIndex:mart.stock.find(s=>s.itemId===i.itemId)?.stockIndex??i.stockIndex}))}};
}

export function rejectShoppingRoute(o,{world,story,planner,state,now,reason,exhausted=false}){
 if(!free(o)||state.active?.kind!=='shop')return null;
 const task=state.active,map=task.objective.target.map;
 // Reuse agenda cooldowns and relevant-state requirements for destinations.
 const ledger=new PostgameAgenda({failures:state.routeFailures??{}});
 ledger.defer(map,reason,now,o);state.routeFailures=ledger.state.failures;
 const selected=exhausted?null:alternative(o,{world,story,planner,state,task,now});
 if(selected){task.objective=selected;return {kind:'alternate',objective:selected};}
 state.deferredShopping={task,reason,exhausted,retryAt:state.routeFailures[map].retryAt,context:postgameFailureContext(o)};
 state.active=null;
 return {kind:'deferred',reason};
}

export function resumeShoppingRoute(o,{world,story,planner,state,now}){
 const held=state.deferredShopping;
 if(!held||state.active||state.suspendedShopping||!free(o)||held.retryAt>now)return false;
 // Exhausted parent budgets require relevant new evidence, not healing, saves,
 // another recommendation or a process restart.
 if(held.exhausted&&held.context===postgameFailureContext(o))return false;
 const selected=alternative(o,{world,story,planner,state,task:held.task,now});
 if(!selected)return false;
 if(Number.isSafeInteger(held.task.lastObservedMoney))held.task.lastObservedMoney=o.playerMemory.trainer.money;
 held.task.objective=selected;state.active=held.task;delete state.deferredShopping;return true;
}
