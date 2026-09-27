import catalog from '../data/item-catalog.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
export const itemCatalog=catalog;
export const heldItemId=p=>Number(p?.item??p?.heldItem??0);
export const hasBattleAbility=(p,id,name)=>Number(p?.ability)===id||p?.ability===`ABILITY_${name}`;
const nativeSpecies=p=>nationalSpeciesId(Number(p?.species));
export function heldItem(p){
 const id=heldItemId(p),row=catalog.items[id];
 if(row?.name==='ITEM_ENIGMA_BERRY'){
  const e=p?.enigmaBerry;
  if(!e||!Number.isInteger(e.effectId)||!Number.isInteger(e.param))return {id,known:false,effect:'UNKNOWN_ENIGMA_EFFECT'};
  const effect=Object.entries(catalog.effects).find(([,v])=>v===e.effectId)?.[0];
  return {id,known:Boolean(effect),effect:effect??'UNKNOWN_ENIGMA_EFFECT',param:e.param};
 }
 return row&&!row.reserved?{...row,known:true}:{id,known:false,effect:'UNKNOWN_ITEM'};
}
const typeEffects=new Map(Object.keys(catalog.effects).filter(e=>/^HOLD_EFFECT_\w+_POWER$/.test(e)).map(e=>[e,'TYPE_'+e.slice(12,-6)]));
export function heldStatFactors(p,{type,physical=false,defending=false,battleFlags=0}={}){
 const item=heldItem(p),e=item.effect,n=nativeSpecies(p);let attack=1,defense=1;
 if(!defending){
  if(typeEffects.get(e)===type)attack*=1+item.param/100;
  if(e==='HOLD_EFFECT_CHOICE_BAND'&&physical)attack*=1.5;
  if(e==='HOLD_EFFECT_SOUL_DEW'&&!physical&&[380,381].includes(n)&&!(battleFlags&256))attack*=1.5;
  if(e==='HOLD_EFFECT_DEEP_SEA_TOOTH'&&!physical&&n===366)attack*=2;
  if(e==='HOLD_EFFECT_LIGHT_BALL'&&!physical&&n===25)attack*=2;
  if(e==='HOLD_EFFECT_THICK_CLUB'&&physical&&[104,105].includes(n))attack*=2;
 }else{
  if(e==='HOLD_EFFECT_SOUL_DEW'&&!physical&&[380,381].includes(n)&&!(battleFlags&256))defense*=1.5;
  if(e==='HOLD_EFFECT_DEEP_SEA_SCALE'&&!physical&&n===366)defense*=2;
  if(e==='HOLD_EFFECT_METAL_POWDER'&&physical&&n===132)defense*=2;
 }
 return {known:item.known,attack,defense};
}
const hpEffects=new Set(['RESTORE_HP','CONFUSE_SPICY','CONFUSE_DRY','CONFUSE_SWEET','CONFUSE_BITTER','CONFUSE_SOUR']);
const statEffects=new Set(['ATTACK_UP','DEFENSE_UP','SPEED_UP','SP_ATTACK_UP','SP_DEFENSE_UP','CRITICAL_UP','RANDOM_STAT_UP']);
const cures={CURE_PAR:64,CURE_SLP:7,CURE_PSN:136,CURE_BRN:16,CURE_FRZ:32,CURE_STATUS:255};
export function berryConfuses(p,effect){
 const stat={HOLD_EFFECT_CONFUSE_SPICY:0,HOLD_EFFECT_CONFUSE_SOUR:1,HOLD_EFFECT_CONFUSE_SWEET:2,HOLD_EFFECT_CONFUSE_DRY:3,HOLD_EFFECT_CONFUSE_BITTER:4}[effect];
 if(stat===undefined)return false;
 const nature=p?.nature?.id??p?.natureId??(Number.isInteger(p?.personality)?p.personality%25:null);
 if(!Number.isInteger(nature)||nature<0||nature>24)return null;
 return Math.floor(nature/5)!==nature%5&&nature%5===stat;
}
const passive=new Set(['MACHO_BRACE','EXP_SHARE','QUICK_CLAW','FRIENDSHIP_UP','CHOICE_BAND','FLINCH','DOUBLE_PRIZE','REPEL','SOUL_DEW','DEEP_SEA_TOOTH','DEEP_SEA_SCALE','CAN_ALWAYS_RUN','PREVENT_EVOLVE','FOCUS_BAND','LUCKY_EGG','SCOPE_LENS','DRAGON_SCALE','LIGHT_BALL','UP_GRADE','LUCKY_PUNCH','METAL_POWDER','THICK_CLUB','STICK','EVASION_UP']);
export function describeHeldItem(id){
 const row=catalog.items[id];if(!row||row.reserved)return null;
 const e=row.effect.slice(12);
 let trigger=hpEffects.has(e)?'hp-half':statEffects.has(e)?'hp-quarter':e in cures||['CURE_CONFUSION','CURE_ATTRACT','RESTORE_STATS'].includes(e)?'status-or-stage-change':e==='RESTORE_PP'?'empty-pp':e==='LEFTOVERS'?'end-turn':e==='SHELL_BELL'?'damage-dealt':e==='NONE'?'no-held-effect':passive.has(e)||typeEffects.has(row.effect)?'passive':null;
 return {...row,known:trigger!==null,trigger,consumable:hpEffects.has(e)||statEffects.has(e)||e in cures||['CURE_CONFUSION','CURE_ATTRACT','RESTORE_STATS','RESTORE_PP'].includes(e),type:typeEffects.get(row.effect)??null};
}
export function heldItemEvents(p,{damageDealt=0}={}){
 const item=heldItem(p),e=item.effect?.slice(12),hp=Number(p?.hp),max=Number(p?.maxHp),status=Number(p?.status1??p?.status??0),volatile=Number(p?.status2??0);
 const events=[];
 if(!item.known||!(hp>0)||!(max>0))return events;
 const heal=(amount,consume=false)=>{const restored=Math.min(max-hp,Math.max(1,Math.floor(amount)));if(restored>0)events.push({kind:'heal',amount:restored,consume});};
 if(e==='LEFTOVERS')heal(max/16);
 if(e==='SHELL_BELL'&&damageDealt>0)heal(damageDealt/Math.max(1,item.param));
 if(hpEffects.has(e)&&hp<=Math.floor(max/2)){
  heal(e==='RESTORE_HP'?item.param:max/Math.max(1,item.param),true);
  if(e.startsWith('CONFUSE_')&&berryConfuses(p,item.effect)!==false)events.push({kind:'flavor-confusion',flavor:e.slice(8).toLowerCase(),uncertain:berryConfuses(p,item.effect)===null});
 }
 if(cures[e]&&(status&cures[e]))events.push({kind:'cure-status',mask:cures[e],consume:true});
 if((e==='CURE_CONFUSION'||e==='CURE_STATUS')&&(volatile&7))events.push({kind:'cure-confusion',consume:true});
 if(e==='CURE_ATTRACT'&&(volatile&0xf0000))events.push({kind:'cure-attract',consume:true});
 if(e==='RESTORE_PP'){
  const slot=(p?.pp??[]).findIndex((pp,i)=>pp===0&&p.moves?.[i]>0);
  if(slot>=0)events.push({kind:'restore-pp',slot,maximum:item.param,consume:true});
 }
 if(e==='RESTORE_STATS'&&Object.values(p.statStages??{}).some(v=>v<6))events.push({kind:'restore-negative-stages',consume:true});
 if(statEffects.has(e)&&hp<=Math.floor(max/Math.max(1,item.param)))events.push({kind:'pinch-boost',effect:e,consume:true});
 return events;
}
export function heldRecovery(p){return heldItemEvents(p).filter(e=>e.kind==='heal'&&!e.consume).reduce((s,e)=>s+e.amount,0);}
export function heldCriticalStage(p){
 const e=heldItem(p).effect,n=nativeSpecies(p);
 return e==='HOLD_EFFECT_SCOPE_LENS'?1:e==='HOLD_EFFECT_LUCKY_PUNCH'&&n===113||e==='HOLD_EFFECT_STICK'&&n===83?2:0;
}
