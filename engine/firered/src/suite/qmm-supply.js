// Opt-in Rare Candy supply through FireRed's "question-mark Mail" (QMM) glitch.
//
// Everything here is ordinary controller input; memory is only read. The
// mechanics (pret/pokefirered c75f352) are summarised in docs/FIRERED-POSTGAME.md:
// a Mail holder whose Mail is Knocked Off in a double battle and that Recycles a
// berry consumed at its position keeps its party mail slot allocated with no
// holder. With that "orphan" plus five written Mails, all six party mail slots
// are allocated, so giving Mail to a Pokémon holding item X returns X to the Bag
// while GiveMailToMon fails. Quitting the Easy Chat screen that follows writes
// nothing. Each iteration: +1 X, -1 Retro Mail.
//
// The setup battle is retried only by a power cycle to its pre-battle native
// save, never by restoring an emulator snapshot.
import {encounterFingerprint as fingerprint} from '../player/encounter-tracker.js';
import {buildPokeBallMartCatalog} from '../player/campaign.js';
import {mapRecommendation} from '../player/delegator.js';
import {evolutionItemRecommendation} from './fire-red-evolution.js';
import {fireRedPokemonCenter} from './fire-red-link-quest.js';
import {itemIsMail,MAIL_NONE} from '../evidence/mail-state.js';

export const QMM_SCHEMA='pokemon-suite/qmm-supply/v1';
export const QMM_ITEMS=Object.freeze([68]);
export const QMM_DEFAULT_STOCK=30;
export const QMM_MAIL_PRICE=50; // ITEM_RETRO_MAIL price (src/data/items.json)
export const QMM_TITLE_DELAY_FRAMES=47; // extra title-screen frames per failed attempt
const ITEM=Object.freeze({RARE_CANDY:68,RETRO_MAIL:132,CHESTO:134,BERRY_POUCH:365,VS_SEEKER:362});
const MOVE=Object.freeze({KNOCK_OFF:282,RECYCLE:278,REST:156,SPORE:147,SLEEP_POWDER:79,LOVELY_KISS:142,HYPNOSIS:95,SING:47,
 REFLECT:115,LIGHT_SCREEN:113,BARRIER:112,SWORDS_DANCE:14});
const SLEEP_MOVES=[MOVE.SPORE,MOVE.SLEEP_POWDER,MOVE.LOVELY_KISS,MOVE.HYPNOSIS,MOVE.SING];
const SLEEPLESS_ABILITIES=new Set(['ABILITY_INSOMNIA','ABILITY_VITAL_SPIRIT']);
const FLAG=Object.freeze({CH_DING_TRADE:0x24d,MIMIEN_TRADE:0x248});
const SPECIES=Object.freeze({SPEAROW:21,FARFETCHD:83,ABRA:63,MR_MIME:122});
// Route 14 Twins Kiri & Jan: Charmander and Squirtle, L29 in every rematch
// tier. No sleep, Follow Me (which redirects ally-targeted moves in Gen III),
// trapping or Encore. Kiri is object index 14 (local ID 15), Jan local ID 14.
export const QMM_SETUP_TRAINER=Object.freeze({trainerId:487,map:'MAP_ROUTE14',objectIndex:14,localIds:[14,15],flagId:0x500+487,anchor:{x:11,y:51}});
export const QMM_WATCH=Object.freeze({flags:[FLAG.CH_DING_TRADE,FLAG.MIMIEN_TRADE,QMM_SETUP_TRAINER.flagId]});
const TRADES=Object.freeze({
 farfetchd:{map:'MAP_VERMILION_CITY_HOUSE2',index:0,requestedSpecies:SPECIES.SPEAROW,receivedSpecies:SPECIES.FARFETCHD,flag:FLAG.CH_DING_TRADE},
 mrMime:{map:'MAP_ROUTE2_HOUSE',index:1,requestedSpecies:SPECIES.ABRA,receivedSpecies:SPECIES.MR_MIME,flag:FLAG.MIMIEN_TRADE},
});
const CAPTURE=Object.freeze({spearow:{map:'MAP_ONE_ISLAND_KINDLE_ROAD',species:SPECIES.SPEAROW},abra:{map:'MAP_ROUTE24',species:SPECIES.ABRA}});
// Route 17's hidden candy lies on the Cycling Road slope, where the field
// controller cannot stop to press A; use the other catalogued candies.
export const QMM_EXCLUDED_CANDY_LOCATIONS=Object.freeze(['collect:MAP_ROUTE17:hidden:6']);
const NEUTRAL={buttons:[],holdFrames:2,releaseFrames:0};
const press=(button,release=4)=>({buttons:[button],holdFrames:1,releaseFrames:release});

const menuOpen=o=>Object.values(o.playerMemory?.ui??{}).some(Boolean);
const field=o=>o.phase==='stable'&&o.emulator?.mode==='overworld'&&!o.emulator.inBattle&&!menuOpen(o);
const bagCount=(o,id)=>Object.values(o.playerMemory?.trainer?.bag??{}).flat().reduce((n,i)=>n+(i?.itemId===id?i.quantity:0),0);
const flag=(o,id)=>o.playerMemory?.storyState?.flagIds?.[id]===true;
const dataOf=d=>d?.data??d??{};
const knows=(p,id)=>(p?.moves??[]).includes(id);
// Boxed records carry experience but no level; derive it from the species'
// growth curve (src/data/pokemon/experience_tables.h formulas).
const GROWTH={
 GROWTH_MEDIUM_FAST:n=>n**3,
 GROWTH_ERRATIC:n=>n<=50?Math.floor(n**3*(100-n)/50):n<=68?Math.floor(n**3*(150-n)/100):n<=98?Math.floor(n**3*Math.floor((1911-10*n)/3)/500):Math.floor(n**3*(160-n)/100),
 GROWTH_FLUCTUATING:n=>n<=15?Math.floor(n**3*(Math.floor((n+1)/3)+24)/50):n<=36?Math.floor(n**3*(n+14)/50):Math.floor(n**3*(Math.floor(n/2)+32)/50),
 GROWTH_MEDIUM_SLOW:n=>n===1?0:Math.floor(6*n**3/5)-15*n**2+100*n-140,
 GROWTH_FAST:n=>Math.floor(4*n**3/5),
 GROWTH_SLOW:n=>Math.floor(5*n**3/4),
};
export function qmmLevel(p,mechanics){
 if(Number.isInteger(p?.level))return p.level;
 const curve=GROWTH[dataOf(mechanics).species?.[p?.species]?.growthRate];
 if(!curve||!Number.isInteger(p?.experience))return null;
 let level=1;while(level<100&&curve(level+1)<=p.experience)level++;return level;
}

export function qmmPartyHoldsMail(o){return Boolean(o?.playerMemory?.mail?.partyHoldsMail??(o?.playerMemory?.trainer?.party??[]).some(p=>itemIsMail(p.heldItem)));}
export function qmmOrphanSlots(o){return o?.playerMemory?.mail?.orphanSlots??[];}
// A reserved (orphaned) party mail slot makes the supply renewable: no further
// setup battle is needed for this save.
export function qmmRenewable(o){return qmmOrphanSlots(o).length>0;}

export class QmmSupplyTask{
 constructor({requestId,itemId=ITEM.RARE_CANDY,stockTarget=QMM_DEFAULT_STOCK,state=null,world,story,mechanics,planner,giveUpTurnByAttempt=[10,10,10]}){
  this.world=world;this.story=story;this.mechanics=dataOf(mechanics);this.planner=planner;
  if(state){
   if(state.schema!==QMM_SCHEMA)throw Error('Invalid Mail supply checkpoint.');
   this.state=structuredClone(state);return;
  }
  if(!QMM_ITEMS.includes(itemId))throw Error('The Mail supply only duplicates Rare Candies.');
  if(!Number.isInteger(stockTarget)||stockTarget<1||stockTarget>999)throw Error('Choose a Rare Candy stock target from 1 to 999.');
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId??''))throw Error('Invalid Mail supply request.');
  this.state={schema:QMM_SCHEMA,requestId,itemId,stockTarget,phase:'detect',reason:null,dirty:false,
   originalParty:null,setup:{attempts:0,giveUpTurnByAttempt:[...giveUpTurnByAttempt],preBattleSave:null,battle:null,postBattleSave:null,roles:null},
   session:null,cleanup:null,receipts:[],progress:null};
 }
 get phase(){return this.state.phase;}
 // Owner key for the postgame progress watchdog: each step, and each new wild
 // encounter while searching, is progress; a stuck step still times out.
 // Species the field player must capture for the current step (hunt targets).
 captureSpecies(){const c=this.state.progress?.step?.startsWith('capture-')?CAPTURE[this.state.progress.step.slice(8)]:null;return c&&this.state.phase==='prerequisites'?c.species:null;}
 watchKey(){
  const s=this.state,p=s.progress??{};
  return [s.requestId,s.phase,p.step??'',p.onSite?`on-site:${p.encounters??0}`:'',s.session?.dupes??'',s.setup?.attempts??''].join(':');
 }

 // One decision: {kind:'wait'|'policy'|'recommendation'|'act'|'power-cycle'|'stop'|'complete', ...}
 inspect(o){
  const s=this.state,m=o.playerMemory??{},t=m.trainer??{};
  if(s.phase==='complete')return {kind:'complete',receipt:s.receipt};
  if(s.phase==='stopped')return {kind:'stop',reason:s.reason};
  if(s.phase==='battle'&&(o.emulator?.inBattle||o.emulator?.mode==='battle'))return this.#battle(o);
  if(o.phase!=='stable'||o.emulator?.inputReady===false)return {kind:'wait'};
  if(o.emulator?.mode==='boot')return {kind:'wait'};
  if(!m.mail)return this.#stop('The native Mail storage is unreadable; the Mail supply cannot verify its state.');
  if(t.partyValidity!=='valid'||t.storage?.validity!=='valid')return {kind:'wait'};
  // Easy Chat and party prompts belong to whichever step opened them.
  if(m.ui?.easyChat)return this.#easyChat(o);
  if(s.pendingPurchase){
   if(bagCount(o,ITEM.RETRO_MAIL)>=s.pendingPurchase.base+s.pendingPurchase.count)s.pendingPurchase=null;
   else return this.#purchaseMail(o,s.pendingPurchase.count,'buy-retro-mail');
  }
  if(s.pendingSave)return this.#save(o,s.pendingSave.label);
  switch(s.phase){
   case 'detect':return this.#detect(o);
   case 'prerequisites':return this.#prerequisites(o);
   case 'setup':return this.#setup(o);
   case 'battle':return this.#battleField(o);
   case 'session':return this.#session(o);
   case 'cleanup':return this.#cleanup(o);
   default:return this.#stop(`Unknown Mail supply phase ${s.phase}.`);
  }
 }

 #stop(reason){this.state.phase='stopped';this.state.reason=reason;return {kind:'stop',reason};}
 #policy(id,target,extra={}){return {kind:'policy',objective:{id:`qmm-${this.state.requestId}-${id}`,target,dialogue:'advance',choice:'yes',
  deferOptionalDetours:true,identityEvolution:true,qmmSupply:true,...extra}};}
 #rec(recommendation,reason=recommendation?.kind){return recommendation?{kind:'recommendation',recommendation:{...recommendation,objective:`qmm-${this.state.requestId}`},reason}:{kind:'wait'};}
 #center(o){return fireRedPokemonCenter(o.playerMemory.map?.id);}
 #allMons(o){const t=o.playerMemory.trainer;return [...t.party,...t.storage.pokemon].filter(p=>p.validity==='valid'&&!p.isEgg).map(p=>Number.isInteger(p.level)?p:{...p,level:qmmLevel(p,this.mechanics)});}
 #species(id){return this.mechanics.species?.[id]??null;}
 #move(id){return this.mechanics.moves?.[id]??null;}
 #ability(p){const abilities=this.#species(p.species)?.abilities??[];return abilities[p.abilityNum?1:0]??abilities[0]??null;}
 #save(o,label){
  // One native save transaction. It owns the menus until the save verifies;
  // #saved(label) then continues the phase that requested it.
  const s=this.state,m=o.playerMemory;
  s.pendingSave??={label,counter:m.gameStats?.savedGame,sha256:o.sram?.sha256};
  const p=s.pendingSave;
  const verified=m.saveAttemptStatus===1&&m.gameStats?.savedGame===p.counter+1&&o.sram?.sha256!==p.sha256;
  if(verified&&field(o)){
   s.pendingSave=null;
   return this.#saved(o,p.label,{counter:m.gameStats.savedGame,sha256:o.sram.sha256,frame:o.frame,map:m.map.id});
  }
  if(!Number.isSafeInteger(p.counter)||!p.sha256)return this.#stop('The native save baseline is unavailable.');
  if(['error','saving-error'].includes(m.ui?.saveDialog?.stage))return this.#stop('The game could not save during the Mail supply.');
  return this.#policy(`save-${label}`,{kind:'save-game',map:m.map.id,saveVerified:verified});
 }

 // ---- detect -------------------------------------------------------------
 #detect(o){
  const s=this.state,m=o.playerMemory;
  if(!field(o))return this.#rec(closeMenus(o));
  // Only a prepared Recycle user's written Mail may already be in the party
  // (a resumed setup); any other Mail belongs to the player.
  const mailHolders=m.trainer.party.filter(p=>itemIsMail(p.heldItem));
  const prepared=mailHolders.length===1&&knows(mailHolders[0],MOVE.RECYCLE)&&m.mail.party.find(x=>x.slot===mailHolders[0].slot)?.hasMail&&!qmmOrphanSlots(o).length;
  if(mailHolders.length&&!prepared)return this.#stop('A party Pokémon holds Mail. Take it off before starting the Mail supply.');
  // Mail is never restored as a held item; the supply takes every Mail back.
  s.originalParty??=m.trainer.party.map(p=>({fingerprint:fingerprint(p),species:p.species,heldItem:itemIsMail(p.heldItem)?0:p.heldItem??0}));
  s.orphanSlots=[...qmmOrphanSlots(o)];
  s.phase=s.orphanSlots.length?'session':'prerequisites';
  s.reason=s.orphanSlots.length?`Reserved party mail slot ${s.orphanSlots.join(', ')} found; no setup battle is needed.`:'No reserved mail slot yet; preparing the one-time setup battle.';
  return this.inspect(o);
 }

 // ---- prerequisites (existing engine objectives) -------------------------
 roles(o){
  // Pure selection of the setup battle's cast from party and PC.
  const all=this.#allMons(o),t=o.playerMemory.trainer;
  const inParty=p=>t.party.some(q=>fingerprint(q)===fingerprint(p));
  const pick=list=>list.sort((a,b)=>Number(inParty(b))-Number(inParty(a))||b.level-a.level)[0]??null;
  const knockOff=pick(all.filter(p=>knows(p,MOVE.KNOCK_OFF)));
  const recycle=pick(all.filter(p=>knows(p,MOVE.RECYCLE)));
  const sleeperScore=p=>{const i=SLEEP_MOVES.findIndex(id=>knows(p,id));return i<0?-1:SLEEP_MOVES.length-i;};
  const used=new Set([knockOff,recycle].filter(Boolean).map(fingerprint));
  const sleeper=all.filter(p=>!used.has(fingerprint(p))&&sleeperScore(p)>0)
   .sort((a,b)=>sleeperScore(b)-sleeperScore(a)||Number(inParty(b))-Number(inParty(a))||b.level-a.level)[0]??null;
  if(sleeper)used.add(fingerprint(sleeper));
  const chestoHolder=all.find(p=>p.heldItem===ITEM.CHESTO&&!used.has(fingerprint(p))&&!SLEEPLESS_ABILITIES.has(this.#ability(p)))??null;
  const attacker=p=>(p.moves??[]).some(id=>Number(this.#move(id)?.power)>1);
  const finishers=all.filter(p=>!used.has(fingerprint(p))&&p!==chestoHolder&&attacker(p)&&p.hp!==0)
   .sort((a,b)=>b.level-a.level).slice(0,2);
  for(const p of finishers)used.add(fingerprint(p));
  const berryHolder=chestoHolder&&!used.has(fingerprint(chestoHolder))?chestoHolder:
   all.filter(p=>!used.has(fingerprint(p))&&!SLEEPLESS_ABILITIES.has(this.#ability(p))&&!itemIsMail(p.heldItem))
    .sort((a,b)=>Number(inParty(b))-Number(inParty(a))||b.level-a.level)[0]??null;
  const chesto=bagCount(o,ITEM.CHESTO)>0||Boolean(chestoHolder);
  return {knockOff,recycle,sleeper,berryHolder,finishers,chesto};
 }
 #mailMart(){
  this.mailMart??=buildPokeBallMartCatalog(this.world,this.story).map(m=>({...m,stock:m.stock.find(i=>i.itemId===ITEM.RETRO_MAIL)})).find(m=>m.stock)??null;
  return this.mailMart;
 }
 #purchaseMail(o,quantity,label){
  const mart=this.#mailMart();
  if(!mart)return this.#stop('No mart selling Retro Mail was found in the cartridge data.');
  const money=Number(o.playerMemory.trainer.money??0),affordable=Math.floor(money/QMM_MAIL_PRICE);
  if(affordable<1){
   const income=this.planner?.selectIncomePreparation?.(o);
   if(income)return {kind:'policy',objective:{...income,identityEvolution:true,qmmSupply:true}};
   return this.#stop('There is not enough money for Retro Mail (₽50 each) and no funding route is available.');
  }
  const count=Math.max(1,Math.min(99,quantity,affordable));
  this.state.pendingPurchase??={base:bagCount(o,ITEM.RETRO_MAIL),count};
  return this.#policy(label,{kind:'purchase-items',map:mart.map,objectIndex:mart.objectIndex,
   // purchase-items quantities are the desired Bag total, not the amount to buy.
   items:[{itemId:ITEM.RETRO_MAIL,quantity:this.state.pendingPurchase.base+this.state.pendingPurchase.count,unitPrice:QMM_MAIL_PRICE,stockIndex:mart.stock.stockIndex}]});
 }
 #mailNeed(o){
  // Five written holders plus one Mail per duplicate still needed (plus the
  // Recycle user's Mail before the reserved slot exists).
  const orphans=qmmOrphanSlots(o).length,held=(o.playerMemory.trainer.party??[]).filter(p=>itemIsMail(p.heldItem)).length;
  const holders=Math.max(0,6-Math.max(1,orphans)-held);
  const dupes=Math.max(0,this.state.stockTarget-bagCount(o,this.state.itemId));
  return holders+dupes+(orphans?0:1);
 }
 #prerequisites(o){
  const s=this.state,m=o.playerMemory,t=m.trainer;
  const r=this.roles(o),all=this.#allMons(o),center=this.#center(o);
  const inParty=p=>t.party.some(q=>fingerprint(q)===fingerprint(p));
  const roster=(label,p)=>this.#policy(label,{kind:'party-roster',map:center,requiredFingerprints:[fingerprint(p)],maximumPartySize:6,avoidDepositBoxes:[2]});
  const trade=(key,p)=>inParty(p)?this.#policy(`trade-${key}`,{kind:'in-game-trade',map:TRADES[key].map,index:TRADES[key].index,
   requestedSpecies:TRADES[key].requestedSpecies,receivedSpecies:TRADES[key].receivedSpecies}):roster(`withdraw-${key}-source`,p);
  const capture=(key)=>{
   // A wild search progresses by encounters; bound it so a wrong area cannot run forever.
   const wild=Number(m.gameStats?.wildBattles??0);
   if(m.map?.id===CAPTURE[key].map)s.capture=s.capture?.key===key?s.capture:{key,startWildBattles:wild};
   const encounters=s.capture?.key===key?wild-s.capture.startWildBattles:0;
   s.progress={...s.progress,step:`capture-${key}`,onSite:m.map?.id===CAPTURE[key].map,encounters};
   if(encounters>=80)return this.#stop(`No ${key} was caught in 80 encounters on ${CAPTURE[key].map}.`);
   return this.#policy(`capture-${key}`,{kind:'encounter-zone',map:CAPTURE[key].map},{captureSpecies:[CAPTURE[key].species],captureFamily:[CAPTURE[key].species]});
  };
  if(!r.knockOff){
   s.progress={step:'knock-off',reason:'Needs a Knock Off user: CH\'DING Farfetch\'d (Vermilion) for a Spearow of level 21–40.'};
   if(flag(o,FLAG.CH_DING_TRADE))return this.#stop('No Pokémon knows Knock Off and the Vermilion Farfetch\'d trade is used.');
   const spearow=all.find(p=>p.species===SPECIES.SPEAROW&&p.level>=21&&p.level<=40);
   return spearow?trade('farfetchd',spearow):capture('spearow');
  }
  if(!r.recycle){
   const mime=all.filter(p=>p.species===SPECIES.MR_MIME).sort((a,b)=>b.level-a.level)[0];
   const train=()=>this.#policy('train-recycle',{kind:'map',map:m.map.id},{minimumCoreLevel:33,coreSpecies:[SPECIES.MR_MIME],
    trainingFingerprint:fingerprint(mime),learnMoveIds:[MOVE.RECYCLE],keepMoveIds:[MOVE.REFLECT,MOVE.BARRIER]});
   if(mime&&mime.level<33){
    s.progress={step:'recycle',reason:`Training Mr. Mime to level 33 for Recycle (now ${mime.level}).`};
    if(!inParty(mime))return roster('withdraw-mr-mime',mime);
    return train();
   }
   // The level-up to 33 is read before its "learn Recycle?" prompt. Keep the
   // training objective (and its learnMoveIds) until the battle and its
   // prompts are over; only a settled field without Recycle is final.
   if(mime&&inParty(mime)&&!field(o))return train();
   if(mime)return this.#stop('Mr. Mime is level 33 or higher but does not know Recycle. Relearn it before the Mail supply.');
   if(flag(o,FLAG.MIMIEN_TRADE))return this.#stop('No Pokémon knows Recycle and the Route 2 Mr. Mime trade is used.');
   s.progress={step:'recycle',reason:'Needs MIMIEN Mr. Mime (Route 2) for an Abra.'};
   const abra=all.filter(p=>p.species===SPECIES.ABRA&&p.level<=46).sort((a,b)=>b.level-a.level)[0];
   return abra?trade('mrMime',abra):capture('abra');
  }
  if(!r.chesto)return this.#stop('The setup battle needs a Chesto Berry (bag or held).');
  if(!r.sleeper)return this.#stop('The setup battle needs an ally with a sleep move such as Spore.');
  if(!r.berryHolder||r.finishers.length<2)return this.#stop('The setup battle needs six suitable Pokémon: a berry holder, a sleep user, the Knock Off and Recycle users and two finishers.');
  if(bagCount(o,ITEM.RETRO_MAIL)<1)return this.#purchaseMail(o,this.#mailNeed(o),'buy-retro-mail');
  s.setup.roles=Object.fromEntries(Object.entries({berry:r.berryHolder,sleeper:r.sleeper,recycle:r.recycle,knockOff:r.knockOff,finisherA:r.finishers[0],finisherB:r.finishers[1]})
   .map(([k,p])=>[k,fingerprint(p)]));
  s.phase='setup';s.progress={step:'setup'};s.reason='Assembling the setup-battle party.';
  return this.inspect(o);
 }

 // ---- setup: party, items, heal, pre-battle native save -------------------
 #setup(o){
  const s=this.state,m=o.playerMemory,t=m.trainer,roles=s.setup.roles;
  const order=['berry','sleeper','recycle','knockOff','finisherA','finisherB'].map(k=>roles[k]);
  const party=t.party.map(fingerprint);
  if(!order.every(f=>this.#allMons(o).some(p=>fingerprint(p)===f))){s.phase='prerequisites';return this.#stop('A setup-battle Pokémon is missing.');}
  if(party.length!==6||!order.every(f=>party.includes(f)))
   return this.#policy('setup-roster',{kind:'party-roster',map:this.#center(o),requiredFingerprints:order,minimumPartySize:6,maximumPartySize:6,avoidDepositBoxes:[2]});
  const misplaced=order.findIndex((f,i)=>party[i]!==f);
  if(misplaced>=0)return this.#rec(partyOrderRecommendation(o,misplaced,party.indexOf(order[misplaced])),'order-setup-party');
  const member=role=>t.party.find(p=>fingerprint(p)===roles[role]);
  const berry=member('berry'),recycle=member('recycle');
  if(berry.heldItem!==ITEM.CHESTO){
   if(berry.heldItem)return this.#item(o,'take-held-item',berry,berry.heldItem);
   if(bagCount(o,ITEM.CHESTO)<1){
    const holder=this.#allMons(o).find(p=>p.heldItem===ITEM.CHESTO);
    if(holder&&t.party.some(p=>fingerprint(p)===fingerprint(holder)))return this.#item(o,'take-held-item',holder,ITEM.CHESTO);
    return this.#stop('The Chesto Berry for the setup battle is not in the Bag.');
   }
   return this.#item(o,'give-held-item',berry,ITEM.CHESTO);
  }
  const link=m.mail.party.find(x=>x.slot===recycle.slot);
  if(!link?.hasMail){
   if(refusedWrite(s,roles.recycle))return this.#stop(refusedWrite(s,roles.recycle));
   if(recycle.heldItem&&!itemIsMail(recycle.heldItem))return this.#item(o,'take-held-item',recycle,recycle.heldItem);
   if(bagCount(o,ITEM.RETRO_MAIL)<1)return this.#purchaseMail(o,this.#mailNeed(o),'buy-retro-mail');
   s.mailStep={kind:'write',fingerprint:roles.recycle};
   return this.#item(o,'give-held-item',recycle,ITEM.RETRO_MAIL);
  }
  const healthy=t.party.every(p=>p.hp===p.maxHp&&!p.status1);
  if(!healthy&&!s.setup.preBattleSave){
   const recovery=this.planner?.selectRecovery?.(o);
   if(recovery)return {kind:'policy',objective:{...recovery,identityEvolution:true,qmmSupply:true}};
  }
  if(!field(o))return this.#rec(closeMenus(o));
  return this.#save(o,'before-setup-battle');
 }
 #saved(o,label,receipt){
  const s=this.state,b=s.setup,ss=s.session??{},m=o.playerMemory;
  if(label==='before-setup-battle'){
   b.preBattleSave=receipt;s.dirty=true;s.phase='battle';b.battle=null;
   s.reason='Pre-battle native save verified; starting the setup double battle.';
   return {kind:'wait'};
  }
  if(label==='after-setup-battle'){
   const orphans=qmmOrphanSlots(o);
   b.postBattleSave=receipt;s.receipts.push({kind:'setup-battle',attempt:b.attempts,orphans,receipt});
   s.orphanSlots=orphans;s.phase='session';s.reason=`Reserved party mail slot ${orphans.join(', ')} verified and saved.`;
   return {kind:'wait'};
  }
  if(label==='mail-supply-complete'){
   s.phase='complete';s.dirty=false;
   s.receipt={requestId:s.requestId,itemId:s.itemId,nativeSaveVerified:true,savedSramSha256:receipt.sha256,savedGame:receipt.counter,savedFrame:receipt.frame,
    duplicated:ss.dupes??0,stock:bagCount(o,s.itemId),stockTarget:s.stockTarget,orphanSlots:[...qmmOrphanSlots(o)],
    box3Slot1Empty:m.mail.box3Slot1?.empty??null,setup:s.receipts.filter(r=>r.kind.startsWith('setup')),partyMailHolders:0,
    iterations:ss.iterations??[]};
   s.reason=`Rare Candy stock ${s.receipt.stock}; saved.`;
   return {kind:'complete',receipt:s.receipt};
  }
  return this.#stop(`Unknown save step ${label}.`);
 }
 #item(o,kind,p,itemId){
  // Each new Give/Take starts from the field. Returning from the party menu
  // to an open Bag can expose the previous list/context cursor for a frame,
  // which once selected USE on a Rare Candy instead of GIVE on the next item.
  const key=`${kind}:${fingerprint(p)}:${itemId}`;
  if(this.state.itemOp!==key){
   if(!field(o))return this.#rec(closeMenus(o));
   this.state.itemOp=key;
  }
  const objective={id:`qmm-${this.state.requestId}-${kind}`,target:{kind,fingerprint:fingerprint(p),map:o.playerMemory.map.id,itemId}};
  // The switch prompt only appears when giving Mail to a holder; answer Yes there.
  if(o.playerMemory.ui?.party?.stage==='confirm-switch-item')return this.#rec({kind:'choose-menu-option',targetOption:'yes',targetIndex:0});
  const r=evolutionItemRecommendation(o,objective);
  if(r?.kind==='stop-for-review')return this.#stop(r.reason);
  return r?this.#rec(r):{kind:'wait'};
 }

 // ---- setup battle ----------------------------------------------------------
 #battleField(o){
  const s=this.state,m=o.playerMemory,b=s.setup;
  if(b.battle&&!b.battle.ended){b.battle.ended=true;b.battle.endFrame=o.frame;b.battle.outcome=m.battleOutcome;}
  if(b.powerCycle){
   // A checkpoint restored after the failed battle (a crash before the reset)
   // never passed the title screen: the Twins are still beaten in RAM. Cycle
   // the console again instead of accepting that field as the retry.
   if(!b.powerCycle.booted){
    b.powerCycle.repeats=(b.powerCycle.repeats??0)+1;
    if(b.powerCycle.repeats>3)return this.#stop('The console did not return to the title screen after a power cycle.');
    return {kind:'power-cycle',reason:'The pending power cycle did not reach the title screen; power cycling again.'};
   }
   // Continue must land on the exact pre-battle native save.
   if(m.gameStats?.savedGame!==b.preBattleSave.counter||o.sram?.sha256!==b.preBattleSave.sha256)
    return this.#stop('After the power cycle the game did not continue from the pre-battle save.');
   b.powerCycle=null;b.battle=null;
  }
  if(b.battle?.ended){
   if(!field(o))return this.#rec(closeMenus(o));
   const orphans=qmmOrphanSlots(o),recycle=m.trainer.party.find(p=>fingerprint(p)===b.roles.recycle);
   const link=recycle?m.mail.party.find(x=>x.slot===recycle.slot):null;
   const success=orphans.length>0&&!qmmPartyHoldsMail(o)&&link&&orphans.includes(link.mailId);
   b.battle.result={success,orphans,recycleHeldItem:recycle?.heldItem??null,recycleMailId:link?.mailId??null};
   if(success)return this.#save(o,'after-setup-battle');
   s.receipts.push({kind:'setup-battle-failed',attempt:b.attempts,result:b.battle.result});
   if(b.attempts>=b.giveUpTurnByAttempt.length)return this.#stop(`The setup battle did not reserve a mail slot after ${b.attempts} attempts. The pre-battle save is unchanged.`);
   b.powerCycle={at:o.frame};
   return {kind:'power-cycle',reason:`Setup attempt ${b.attempts} did not reserve a mail slot; power cycling to the pre-battle save.`};
  }
  const trainer=QMM_SETUP_TRAINER,fought=flag(o,trainer.flagId);
  const rematch=trainer.localIds.some(id=>Number(m.vsSeeker?.rematchEntries?.[id]??0)>0);
  if(fought&&!rematch&&!m.ui?.fieldDialog){
   // Already-fought pair: charge and use the VS Seeker beside them (70% per use).
   if(Number(m.vsSeeker?.batterySteps??0)<100&&m.map?.id===trainer.map){
    const paced=this.#recharge(o);
    if(paced)return paced;
   }
   return this.#policy('setup-vs-seeker',{kind:'vs-seeker-activation',map:trainer.map,x:trainer.anchor.x,y:trainer.anchor.y},
    {trainingSource:'vs-seeker',vsSeekerAction:'activate',vsSeekerBatch:{localIds:[...trainer.localIds]},trainer:{localId:trainer.localIds[1]}});
  }
  return this.#policy('setup-battle',{kind:'object',map:trainer.map,index:trainer.objectIndex});
 }
 #recharge(o){
  // Pace between the anchor and a free neighbouring tile until 100 steps.
  const m=o.playerMemory,cells=m.mapGrid?.cells??[],a=QMM_SETUP_TRAINER.anchor;
  const free=(x,y)=>{const c=cells.find(c=>c.x===x&&c.y===y);return c&&Number(c.collision)===0&&!(m.objectEvents??[]).some(e=>!e.player&&e.current?.x===x&&e.current?.y===y);};
  const side=[[-1,0],[0,1],[0,-1],[1,0]].find(([dx,dy])=>free(a.x+dx,a.y+dy));
  if(!side)return this.#stop('No free tile beside the setup trainer to recharge the VS Seeker.');
  const atAnchor=m.position.x===a.x&&m.position.y===a.y,atSide=m.position.x===a.x+side[0]&&m.position.y===a.y+side[1];
  if(!atAnchor&&!atSide)return null; // walk to the anchor first
  const [dx,dy]=atAnchor?side:[-side[0],-side[1]];
  return {kind:'act',reason:'recharge-vs-seeker',action:{buttons:[dx<0?'left':dx>0?'right':dy<0?'up':'down'],holdFrames:16,releaseFrames:2}};
 }
 #battle(o){
  const s=this.state,m=o.playerMemory,b=s.setup,ui=m.ui??{},battle=m.battle;
  if(!b.battle){
   // Only the setup trainer's battle is choreographed; the field player
   // handles anything else (e.g. a wild encounter on the way).
   const trainerBattle=(Number(m.battleTypeFlags)&8)!==0;
   if(!battle||!trainerBattle||Number(battle.trainerId)!==QMM_SETUP_TRAINER.trainerId)return {kind:'defer',reason:'not-the-setup-battle'};
   b.attempts+=1;b.battle={attempt:b.attempts,startFrame:o.frame,turns:[],ended:false,recycled:false,gaveUp:false,pending:null};
  }
  const st=b.battle;
  if(o.phase!=='stable'||o.emulator?.inputReady===false)return {kind:'wait'};
  const map=r=>({kind:'act',reason:r.kind,action:mapRecommendation(r,o)});
  if(ui.moveLearning){
   if(ui.moveLearning.stage==='confirm-replace')return map({kind:'choose-menu-option',targetOption:'no',targetIndex:1});
   if(ui.moveLearning.stage==='confirm-stop-learning')return map({kind:'choose-menu-option',targetOption:'yes',targetIndex:0});
   return {kind:'act',reason:'dismiss-move-learning',action:press('b')};
  }
  if(ui.party){
   const want=st.pendingSwitch??this.#replacement(o);
   const party=m.trainer.party;
   if(ui.party.stage==='message')return {kind:'act',reason:'party-message',action:press('a')};
   const index=party.findIndex(p=>fingerprint(p)===want);
   if(ui.party.stage==='choose-pokemon')return index<0?{kind:'act',reason:'close-battle-party',action:press('b')}:map({kind:'choose-party-member',targetPartySlot:index});
   if(ui.party.stage==='selection-menu')return ui.party.selectedPartySlot!==index?{kind:'act',reason:'wrong-member',action:press('b')}:map({kind:'choose-menu-option',targetIndex:0});
   return {kind:'wait'};
  }
  const stage=ui.battle?.stage;
  if(!battle||!stage)return {kind:'wait'};
  if(stage==='message'||stage==='level-up-stats')return {kind:'act',reason:'battle-message',action:press('a')};
  if(stage==='action'){
   const battler=ui.battle.battler;
   if(!st.pending||st.pending.battler!==battler||st.pending.turn!==battle.turn){
    st.pending={battler,turn:battle.turn,...this.#decide(o,battler)};st.pendingSwitch=null;
    st.turns.push({turn:battle.turn,battler,choice:{...st.pending},usedHeldItems:battle.usedHeldItems,knockedOffMons:battle.knockedOffMons,
     battlers:battle.battlers.map(x=>x&&{battler:x.battler,species:x.species,hp:x.hp,maxHp:x.maxHp,item:x.item})});
   }
   if(st.pending.command==='switch'){
    st.pendingSwitch=st.pending.fingerprint;
    if(st.switchTurn!==battle.turn){st.switchTurn=battle.turn;st.switches=[];}
    if(!st.switches.includes(st.pending.fingerprint))st.switches.push(st.pending.fingerprint);
    return map({kind:'choose-battle-command',targetCommand:'pokemon'});
   }
   return map({kind:'choose-battle-command',targetCommand:'fight'});
  }
  if(stage==='move'){
   if(st.pending?.command!=='fight'||st.pending.battler!==ui.battle.battler)return {kind:'act',reason:'back-to-actions',action:press('b')};
   return map({kind:'choose-battle-move',targetMoveSlot:st.pending.moveSlot});
  }
  if(stage==='target')return st.pending?.target===undefined?{kind:'act',reason:'default-target',action:press('a')}:map({kind:'confirm-battle-target',targetBattler:st.pending.target});
  return {kind:'wait'};
 }
 // FRLG seeds its RNG from the frame the title screen is left, and emulation
 // is deterministic: a retry that pressed Continue on the same frame would
 // replay the failed battle exactly. Wait longer on the title screen for each
 // attempt (hardware timing varies naturally). Ordinary input only.
 titleScreenDelay(o){
  const pc=this.state.setup?.powerCycle;
  if(!pc||this.state.phase!=='battle'||!['CB2_InitTitleScreen','CB2_TitleScreenRun'].includes(o.emulator?.callback2))return null;
  pc.booted=true;
  if(!Number.isSafeInteger(pc.titleFrame)||o.frame<pc.titleFrame)pc.titleFrame=o.frame;
  const remaining=QMM_TITLE_DELAY_FRAMES*this.state.setup.attempts-(o.frame-pc.titleFrame);
  return remaining>0?{frames:Math.min(30,remaining),reason:`Waiting ${remaining} more title-screen frames so retry ${this.state.setup.attempts+1} starts from a new RNG seed.`}:null;
 }
 battleEnded(o){
  // Called by the owner when the setup battle hands back to the field.
  if(this.state.phase==='battle'&&this.state.setup.battle&&!this.state.setup.battle.ended&&!o.emulator?.inBattle&&o.emulator?.mode!=='battle'){
   this.state.setup.battle.ended=true;this.state.setup.battle.endFrame=o.frame;this.state.setup.battle.outcome=o.playerMemory.battleOutcome;return true;
  }
  return false;
 }
 #role(o,battler){
  const slot=o.playerMemory.battle?.battlerPartyIndexes?.[battler],p=o.playerMemory.trainer.party?.[slot];
  const f=p?fingerprint(p):null;return Object.entries(this.state.setup.roles).find(([,v])=>v===f)?.[0]??null;
 }
 #replacement(o){
  // Never pick a member the other battler already chose to send in this turn.
  const st=this.state.setup.battle,turn=o.playerMemory.battle?.turn,chosen=new Set(st?.switchTurn===turn?st.switches??[]:[]);
  const r=this.state.setup.roles,party=o.playerMemory.trainer.party,active=new Set([0,2].map(i=>o.playerMemory.battle?.battlerPartyIndexes?.[i]));
  return [r.finisherA,r.finisherB,r.recycle,r.knockOff,r.sleeper,r.berry].find(f=>!chosen.has(f)&&party.some((p,i)=>fingerprint(p)===f&&p.hp>0&&!active.has(i)))??null;
 }
 #decide(o,battler){
  // State-driven turn plan (docs/FIRERED-POSTGAME.md, Mail supply).
  const st=this.state.setup.battle,battle=o.playerMemory.battle,me=battle.battlers[battler];
  const left=battle.battlers[0],leftRole=this.#role(o,0),rightRole=this.#role(o,2),role=this.#role(o,battler);
  const foes=battle.battlers.filter(x=>x&&(x.battler&1)===1&&x.hp>0);
  const consumed=Number(battle.usedHeldItems?.[0]??0)!==0;
  if(leftRole==='recycle'&&Number(left?.item)===ITEM.CHESTO&&consumed===false)st.recycled=true;
  const giveUpTurn=this.state.setup.giveUpTurnByAttempt[Math.min(this.state.setup.attempts,this.state.setup.giveUpTurnByAttempt.length)-1]??10;
  if(!st.recycled&&battle.turn>=giveUpTurn&&!st.gaveUp)st.gaveUp=true;
  const slot=id=>me.moves.findIndex((x,i)=>x===id&&me.pp[i]>0);
  const harmless=()=>{
   const options=me.moves.map((id,i)=>({id,i,move:this.#move(id)})).filter(x=>x.id&&me.pp[x.i]>0&&x.move&&Number(x.move.power)===0&&
    !['MOVE_TARGET_FOES_AND_ALLY'].includes(x.move.target)&&x.id!==MOVE.RECYCLE);
   const self=options.find(x=>['MOVE_TARGET_USER','MOVE_TARGET_USER_OR_SELECTED'].includes(x.move.target));
   const pick=self??options[0];
   if(pick)return {command:'fight',moveSlot:pick.i,...(pick.move.target==='MOVE_TARGET_SELECTED'?{target:foes[0]?.battler??1}:{})};
   return this.#weakestAttack(me,foes);
  };
  const switchTo=f=>({command:'switch',fingerprint:f});
  if(st.recycled||st.gaveUp){
   if(!['finisherA','finisherB'].includes(role)){
    const f=this.#replacement(o);
    if(f)return switchTo(f);
   }
   return this.#strongestAttack(me,foes);
  }
  if(!consumed){
   if(battler===0&&leftRole==='berry'){
    if(me.hp<me.maxHp&&slot(MOVE.REST)>=0)return {command:'fight',moveSlot:slot(MOVE.REST)};
    return harmless();
   }
   if(battler===2&&rightRole==='sleeper'){
    const move=SLEEP_MOVES.map(slot).find(i=>i>=0);
    if(move!==undefined&&Number(left?.status1??0)===0&&leftRole==='berry')return {command:'fight',moveSlot:move,target:0};
   }
   st.gaveUp=true;return this.#decide(o,battler);
  }
  if(leftRole!=='recycle'){
   if(battler===0)return switchTo(this.state.setup.roles.recycle);
   return rightRole==='knockOff'?harmless():switchTo(this.state.setup.roles.knockOff);
  }
  if(Number(left.item)!==0){
   if(battler===2)return rightRole==='knockOff'&&slot(MOVE.KNOCK_OFF)>=0?{command:'fight',moveSlot:slot(MOVE.KNOCK_OFF),target:0}:switchTo(this.state.setup.roles.knockOff);
   // Mr. Mime is faster than the Knock Off user; protect instead of a failing Recycle.
   const screen=[MOVE.REFLECT,MOVE.LIGHT_SCREEN,MOVE.BARRIER].map(slot).find(i=>i>=0);
   return screen!==undefined?{command:'fight',moveSlot:screen}:harmless();
  }
  if(battler===0)return slot(MOVE.RECYCLE)>=0?{command:'fight',moveSlot:slot(MOVE.RECYCLE)}:(st.gaveUp=true,this.#decide(o,battler));
  return harmless();
 }
 #estimate(me,index,foe){
  const move=this.#move(me.moves[index]);
  if(!move||!Number(move.power)||me.pp[index]<=0||['MOVE_TARGET_FOES_AND_ALLY'].includes(move.target)||[63,200,19,91].includes(move.id))return 0;
  const special=['TYPE_FIRE','TYPE_WATER','TYPE_GRASS','TYPE_ELECTRIC','TYPE_PSYCHIC','TYPE_ICE','TYPE_DRAGON','TYPE_DARK'].includes(move.type);
  const a=special?me.stats.spAttack:me.stats.attack,d=Math.max(1,special?foe.stats.spDefense:foe.stats.defense);
  const chart=this.mechanics.typeChart??[],types=TYPES;
  const eff=[...new Set(foe.types??[])].reduce((x,t)=>{const e=chart.find(c=>c.attackingType===move.type&&c.defendingType===types[t]);return x*(e?e.multiplier/10:1);},1);
  const stab=(me.types??[]).map(t=>types[t]).includes(move.type)?1.5:1;
  return ((2*me.level/5+2)*Number(move.power)*a/d/50+2)*stab*eff*(Number(move.accuracy)||100)/100;
 }
 #strongestAttack(me,foes){
  let best=null;
  for(const foe of foes)for(let i=0;i<4;i++){const v=this.#estimate(me,i,foe);if(v>0&&(!best||v>best.v||v===best.v&&foe.hp<best.hp))best={v,i,target:foe.battler,hp:foe.hp};}
  if(best)return {command:'fight',moveSlot:best.i,target:best.target};
  const any=me.pp.findIndex((pp,i)=>pp>0&&me.moves[i]);return {command:'fight',moveSlot:Math.max(0,any),target:foes[0]?.battler??1};
 }
 #weakestAttack(me,foes){
  const foe=[...foes].sort((a,b)=>b.hp-a.hp)[0];let best=null;
  for(let i=0;i<4;i++){const v=foe?this.#estimate(me,i,foe):0;if(v>0&&(!best||v<best.v))best={v,i};}
  return {command:'fight',moveSlot:best?.i??Math.max(0,me.pp.findIndex(pp=>pp>0)),target:foe?.battler??1};
 }

 // ---- duplication session ------------------------------------------------
 #session(o){
  const s=this.state,m=o.playerMemory,t=m.trainer;
  const orphans=qmmOrphanSlots(o);
  if(!orphans.length)return this.#stop('The reserved party mail slot is no longer present.');
  s.session??={startedAt:o.frame,startCandies:bagCount(o,s.itemId),heldBefore:null,holders:null,seed:null,dupes:0,iterations:[]};
  const ss=s.session;
  if(!ss.holders){
   // Before any Mail is handed out: verify Box 3 slot 1, stock and party.
   if(qmmPartyHoldsMail(o))return this.#stop('A party Pokémon already holds Mail; the duplicate session needs every Mail under its control.');
   const box=m.mail.box3Slot1;
   if(!box)return this.#stop('Box 3 slot 1 is unreadable.');
   if(!box.empty){
    // mail[0xFF] aliases Box 3 slot 1. Move its occupant to another box.
    const occupant=t.storage.pokemon.find(p=>p.box===2&&p.slot===0);
    ss.box3Guard??={occupant:occupant?fingerprint(occupant):null};
    if(!occupant)return this.#stop('Box 3 slot 1 holds an unreadable record; the Mail supply will not open its alias.');
    return this.#policy('box3-slot1-withdraw',{kind:'party-roster',map:this.#center(o),requiredFingerprints:[fingerprint(occupant)],maximumPartySize:6,avoidDepositBoxes:[2]});
   }
   if(ss.box3Guard?.occupant&&t.party.some(p=>fingerprint(p)===ss.box3Guard.occupant)){
    const keep=t.party.map(fingerprint).filter(f=>f!==ss.box3Guard.occupant);
    return this.#policy('box3-slot1-deposit',{kind:'party-roster',map:this.#center(o),requiredFingerprints:keep,maximumPartySize:keep.length,avoidDepositBoxes:[2]});
   }
   // One shopping trip for the whole session; money limits the duplicates.
   const need=this.#mailNeed(o),mail=bagCount(o,ITEM.RETRO_MAIL),minimum=Math.max(0,6-orphans.length)+1;
   if(mail<minimum||mail<need&&!ss.purchased){
    ss.purchased=true;
    return this.#purchaseMail(o,need-mail,'buy-retro-mail');
   }
   if(bagCount(o,s.itemId)<1&&!t.party.some(p=>p.heldItem===s.itemId)){
    // A single real seed item is needed; the supply duplicates it from then on.
    const seed=this.planner?.selectItemPreparation?.(o,s.itemId,1,{excludeLocationIds:QMM_EXCLUDED_CANDY_LOCATIONS});
    if(!seed)return this.#stop('The Mail supply needs one Rare Candy to duplicate and none is reachable.');
    return {kind:'policy',objective:{...seed,identityEvolution:true,qmmSupply:true}};
   }
   const holdersNeeded=Math.max(0,6-orphans.length);
   if(t.party.length<holdersNeeded+1)
    return this.#policy('session-party',{kind:'party-roster',map:this.#center(o),minimumPartySize:holdersNeeded+1,maximumPartySize:6,avoidDepositBoxes:[2]});
   // Prefer the orphan's own former holder as the seed: its failed Give then
   // opens the orphan's record instead of the mail[0xFF] alias of Box 3 slot 1.
   const links=new Map(m.mail.party.map(x=>[x.slot,x]));
   const seed=[...t.party].sort((a,b)=>Number(orphans.includes(links.get(b.slot)?.mailId))-Number(orphans.includes(links.get(a.slot)?.mailId))||
    Number(b.heldItem===s.itemId)-Number(a.heldItem===s.itemId))[0];
   ss.seed=fingerprint(seed);ss.seedMailId=links.get(seed.slot)?.mailId??MAIL_NONE;
   ss.holders=t.party.filter(p=>p!==seed).slice(0,holdersNeeded).map(fingerprint);
   ss.heldBefore=Object.fromEntries(t.party.map(p=>[fingerprint(p),p.heldItem??0]));
   s.dirty=true;
  }
  const member=f=>t.party.find(p=>fingerprint(p)===f);
  if(ss.holders.some(f=>!member(f))||!member(ss.seed))return this.#stop('A Mail supply party member left the party.');
  for(const f of ss.holders){
   const p=member(f),link=m.mail.party.find(x=>x.slot===p.slot);
   if(link?.hasMail)continue;
   if(refusedWrite(s,f))return this.#stop(refusedWrite(s,f));
   if(bagCount(o,ITEM.RETRO_MAIL)<1)return this.#stop('Retro Mail ran out while preparing the holders.');
   s.mailStep={kind:'write',fingerprint:f};
   return this.#item(o,'give-held-item',p,ITEM.RETRO_MAIL);
  }
  if(m.mail.allocatedPartySlots<6)return this.#stop(`Only ${m.mail.allocatedPartySlots} of 6 party mail slots are allocated; duplication would give real Mail.`);
  const seed=member(ss.seed);
  if(seed.heldItem!==s.itemId){
   if(seed.heldItem)return this.#item(o,'take-held-item',seed,seed.heldItem);
   if(bagCount(o,s.itemId)<1)return this.#stop('The seed item left the Bag.');
   return this.#item(o,'give-held-item',seed,s.itemId);
  }
  const candies=bagCount(o,s.itemId);
  s.progress={step:'duplicate',candies,target:s.stockTarget,dupes:ss.dupes,mail:bagCount(o,ITEM.RETRO_MAIL)};
  if(ss.pendingDupe){
   const gained=candies-ss.pendingDupe.candies,spent=ss.pendingDupe.mail-bagCount(o,ITEM.RETRO_MAIL);
   if(gained===0&&spent===0)return this.#item(o,'give-held-item',seed,ITEM.RETRO_MAIL);
   if(gained!==1||spent!==1||seed.heldItem!==s.itemId)return this.#stop(`A duplication step changed the Bag unexpectedly (+${gained} item, -${spent} Mail).`);
   const box=m.mail.box3Slot1?.head??null;
   ss.dupes+=1;ss.iterations.push({frame:o.frame,candies,ec:ss.pendingDupe.ec??null,box3Slot1Unchanged:JSON.stringify(box)===JSON.stringify(ss.pendingDupe.box3)});ss.pendingDupe=null;
  }
  if(candies<s.stockTarget&&bagCount(o,ITEM.RETRO_MAIL)>0){
   if(ss.seedMailId===MAIL_NONE&&!m.mail.box3Slot1?.empty)return this.#stop('Box 3 slot 1 became occupied during the Mail supply.');
   ss.pendingDupe={candies,mail:bagCount(o,ITEM.RETRO_MAIL),box3:m.mail.box3Slot1?.head??null};
   s.mailStep={kind:'quit',fingerprint:ss.seed};
   return this.#item(o,'give-held-item',seed,ITEM.RETRO_MAIL);
  }
  if(!field(o)&&!m.ui?.bag&&!m.ui?.party&&!m.ui?.startMenu)return this.#rec(closeMenus(o));
  s.phase='cleanup';s.cleanup={startedAt:o.frame};s.reason=`Duplicated ${ss.dupes}; restoring the party.`;
  return this.inspect(o);
 }

 // ---- Easy Chat --------------------------------------------------------------
 #easyChat(o){
  const s=this.state,ec=o.playerMemory.ui.easyChat;
  if(!ec.inputReady)return {kind:'wait'};
  let step=s.mailStep??{kind:'quit'};
  // Only a free party mail slot may be written. The "?" Mail (mail[0xFF], the
  // Box 3 slot 1 alias) and the reserved record are always quit unedited.
  const writable=Number.isInteger(ec.mailIndex)&&ec.mailIndex<6&&!ec.aliasesBox3Slot1&&!qmmOrphanSlots(o).includes(ec.mailIndex);
  if(step.kind==='write'&&!writable){
   if(!Number.isInteger(ec.mailIndex))return this.#stop('The Easy Chat screen does not show which Mail it edits; the Mail supply will not write it.');
   step=s.mailStep={...step,kind:'quit',refusedMailIndex:ec.mailIndex};
  }
  if(step.kind==='quit'){
   if(s.session?.pendingDupe&&!s.session.pendingDupe.ec)s.session.pendingDupe.ec={mailIndex:ec.mailIndex,aliasesBox3Slot1:ec.aliasesBox3Slot1,words:ec.buffer};
   // Never edit the "?" Mail: B, then Yes on "Quit?" (the cursor opens on No).
   if(ec.stage==='confirm-quit')return {kind:'act',reason:'quit-question-mail',action:press(ec.menuCursor===0?'a':'up',8)};
   return {kind:'act',reason:'leave-question-mail',action:press('b',8)};
  }
  // Write one word so the Mail stays attached (cancel returns it to the Bag).
  if(ec.stage==='field')return {kind:'act',reason:'write-mail',action:press(ec.edited?'start':'a',8)};
  if(ec.stage==='group'||ec.stage==='word')return {kind:'act',reason:'choose-mail-word',action:press('a',8)};
  if(ec.stage==='confirm-message')return {kind:'act',reason:'confirm-mail',action:press(ec.menuCursor===0?'a':'up',8)};
  if(ec.stage==='confirm-quit')return {kind:'act',reason:'keep-writing',action:press(ec.menuCursor===1?'a':'down',8)};
  return {kind:'act',reason:'easy-chat-back',action:press('b',8)};
 }

 // ---- cleanup ----------------------------------------------------------------
 #cleanup(o){
  const s=this.state,m=o.playerMemory,t=m.trainer,ss=s.session??{};
  const mailHolder=t.party.find(p=>itemIsMail(p.heldItem));
  if(mailHolder)return this.#takeMail(o,mailHolder);
  // Restore items the session moved, then the original party, then save.
  for(const [f,item] of Object.entries(ss.heldBefore??{})){
   const p=t.party.find(q=>fingerprint(q)===f);
   if(!p||p.heldItem===item)continue;
   if(p.heldItem)return this.#item(o,'take-held-item',p,p.heldItem);
   if(item&&bagCount(o,item)>0)return this.#item(o,'give-held-item',p,item);
  }
  const original=s.originalParty??[];
  const party=t.party.map(fingerprint),order=original.map(x=>x.fingerprint);
  if(order.length&&(party.length!==order.length||!order.every(f=>party.includes(f))))
   return this.#policy('restore-roster',{kind:'party-roster',map:this.#center(o),requiredFingerprints:order,minimumPartySize:order.length,maximumPartySize:order.length,avoidDepositBoxes:[2]});
  const misplaced=order.findIndex((f,i)=>party[i]!==f);
  if(misplaced>=0)return this.#rec(partyOrderRecommendation(o,misplaced,party.indexOf(order[misplaced])),'restore-party-order');
  for(const x of original){
   const p=t.party.find(q=>fingerprint(q)===x.fingerprint);
   if(p.heldItem===x.heldItem)continue;
   if(p.heldItem&&!itemIsMail(p.heldItem))return this.#item(o,'take-held-item',p,p.heldItem);
   if(x.heldItem&&bagCount(o,x.heldItem)>0)return this.#item(o,'give-held-item',p,x.heldItem);
  }
  if(!field(o))return this.#rec(closeMenus(o));
  return this.#save(o,'mail-supply-complete');
 }
 #takeMail(o,p){
  const ui=o.playerMemory.ui??{},slot=o.playerMemory.trainer.party.indexOf(p);
  if(ui.party?.stage==='confirm-send-mail-to-pc')return this.#rec({kind:'choose-menu-option',targetOption:'no',targetIndex:1});
  if(ui.party?.stage==='confirm-lose-mail')return this.#rec({kind:'choose-menu-option',targetOption:'yes',targetIndex:0});
  if(ui.party?.stage==='message')return this.#rec({kind:'acknowledge-cartridge-prompt'});
  if(ui.party?.stage==='selection-menu'){
   if(ui.party.selectedPartySlot!==slot)return this.#rec({kind:'close-menu'});
   const actions=ui.party.actions??[],action=actions.includes('take-mail')?'take-mail':'mail';
   return actions.includes(action)?this.#rec({kind:'choose-party-action',targetAction:action,targetIndex:actions.indexOf(action)}):this.#rec({kind:'close-menu'});
  }
  if(ui.party?.stage==='choose-pokemon')return this.#rec({kind:'choose-party-member',targetPartySlot:slot});
  if(ui.startMenu){const index=ui.startMenu.order?.indexOf('pokemon')??-1;return this.#rec({kind:'choose-start-menu-item',targetItem:'pokemon',targetIndex:index});}
  if(menuOpen(o))return this.#rec({kind:'close-menu'});
  return o.emulator?.mode==='overworld'?this.#rec({kind:'open-start-menu'}):{kind:'wait'};
 }
}

// A holder's Give that opened the "?" Mail or the reserved record means the
// party mail slots are not as counted; never retry it (each retry would
// duplicate that holder's item).
function refusedWrite(s,fingerprint){
 const step=s.mailStep;
 return step?.fingerprint===fingerprint&&Number.isInteger(step.refusedMailIndex)?
  `Giving Mail to a holder opened mail record ${step.refusedMailIndex} instead of a free party slot; the Mail supply stopped without writing it.`:null;
}

const TYPES=['TYPE_NORMAL','TYPE_FIGHTING','TYPE_FLYING','TYPE_POISON','TYPE_GROUND','TYPE_ROCK','TYPE_BUG','TYPE_GHOST','TYPE_STEEL','TYPE_MYSTERY','TYPE_FIRE','TYPE_WATER','TYPE_GRASS','TYPE_ELECTRIC','TYPE_PSYCHIC','TYPE_ICE','TYPE_DRAGON','TYPE_DARK'];

export function closeMenus(o){
 const ui=o.playerMemory?.ui??{};
 if(ui.party?.stage==='message'||ui.fieldDialog)return {kind:'acknowledge-cartridge-prompt'};
 return Object.values(ui).some(Boolean)?{kind:'close-menu'}:null;
}

// Party menu SWITCH: move the member at `from` to `to` (Start > POKéMON).
export function partyOrderRecommendation(o,to,from){
 const ui=o.playerMemory?.ui??{};
 if(ui.party?.stage==='choose-switch-target')return {kind:'choose-party-member',targetPartySlot:to};
 if(ui.party?.stage==='selection-menu'){
  if(ui.party.selectedPartySlot!==from)return {kind:'close-menu'};
  const index=ui.party.actions?.indexOf('switch')??-1;
  return index>=0?{kind:'choose-party-action',targetAction:'switch',targetIndex:index}:{kind:'close-menu'};
 }
 if(ui.party?.stage==='choose-pokemon')return {kind:'choose-party-member',targetPartySlot:from};
 if(ui.party?.stage==='message')return {kind:'acknowledge-cartridge-prompt'};
 if(ui.startMenu){const index=ui.startMenu.order?.indexOf('pokemon')??-1;return {kind:'choose-start-menu-item',targetItem:'pokemon',targetIndex:index};}
 if(Object.values(ui).some(Boolean))return {kind:'close-menu'};
 return o.emulator?.mode==='overworld'?{kind:'open-start-menu'}:null;
}
