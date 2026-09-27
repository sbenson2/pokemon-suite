// A passive Exp. Share trainee during postgame League rounds. When five
// sweep-level permanent-team battlers can carry the round, the sixth party slot goes to a
// Pokemon that still needs levels; it holds the Exp. Share and never fights.
// Composition reuses the existing identity-based PC roster target and the
// give/take/lead held-item targets; round state lives in the agenda workflows.
// The league-training checklist entry runs rounds of its own only while a Dex
// level-up, team or current trainee remains (refreshLeagueTraining).
import {createHash} from 'node:crypto';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {permanentTrainingParty,obedienceRisk} from '../player/training-policy.js';
import {hasUsableAttackingPp} from '../player/recovery.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
import {qmmLevel} from './qmm-supply.js';
import {ownedDexEvolutionOptions} from './fire-red-evolution.js';

export const LEAGUE_EXP_SHARE_ITEM=182;
const MAIL=id=>Number(id)>=121&&Number(id)<=132;
// An Everstone holder stays home: taking the item for the Exp. Share would let
// it evolve.
const EVERSTONE=195;
const same=(left,right)=>Boolean(left&&right)&&Number(left.personality)===Number(right.personality)&&Number(left.otId)===Number(right.otId);
const identity=p=>({personality:p.personality,otId:p.otId,species:p.species});

// Battlers that carry a League round without the trainee must be this many
// levels above the rematch Champion's ace (75 in FireRed: level 90), capped at 100.
export const LEAGUE_SWEEP_MARGIN=15;
export const leagueRematchLevels=mechanics=>Object.values((mechanics?.data??mechanics)?.trainers??{}).filter(t=>t?.name?.startsWith('TRAINER_CHAMPION_REMATCH_'))
 .flatMap(t=>t.party.map(p=>Number(p.lvl))).filter(Number.isFinite);
export const leagueSweepLevel=levels=>levels.length?Math.min(100,Math.max(...levels)+LEAGUE_SWEEP_MARGIN):null;
const speciesName=(mechanics,id)=>{
 const name=Object.values((mechanics?.data??mechanics)?.species??{}).find(s=>Number(s?.id)===Number(id))?.name;
 return name?String(name).replace(/^SPECIES_/,'').toLowerCase().replace(/(^|_)(\w)/g,(_,sep,c)=>(sep?' ':'')+c.toUpperCase()):`#${id}`;
};

function members(o,mechanics){
 const t=o.playerMemory?.trainer??{};
 const level=p=>({...p,level:Number.isInteger(p.level)?p.level:qmmLevel(p,mechanics)});
 const valid=p=>p?.validity==='valid'&&!p.isEgg&&Number(p.species)>0;
 return {party:(t.party??[]).filter(valid).map(level),stored:(t.storage?.pokemon??[]).filter(valid).map(level)};
}

// Why the round keeps the full battle team, or the chosen five and trainee.
// Five battlers must be permanent-team members at the sweep level (the caller
// passes the rematch Champion's ace + 15, capped at 100), obedient and with
// usable attacking PP. A starter-family member cannot be deposited by the
// roster rules, so it is either a battler or the trainee. A hold, an unjudged
// round or the owner's Bot setting (owner.enabled false) keeps the full team.
export function leagueExpSharePlan({o,mechanics,teamPlan,state=null,protectedFingerprints=[],sweepLevel,owner=null,includeFiller=true}={}){
 const inactive=reason=>({active:false,reason});
 if(state?.disabled)return inactive(`disabled:${state.disabled.reason}`);
 if(state?.round)return inactive('round-unjudged');
 if(owner?.enabled===false)return inactive('owner-off');
 if(!teamPlan?.permanentFamilies?.length)return inactive('no-permanent-team');
 const t=o?.playerMemory?.trainer;
 if(t?.partyValidity!=='valid'||t.storage?.validity!=='valid')return inactive('party-or-storage-unknown');
 if(!(Number(sweepLevel)>0))return inactive('no-sweep-level');
 const {party,stored}=members(o,mechanics),all=[...party,...stored];
 const team=new Set(permanentTrainingParty(all,teamPlan));
 const starter=new Set((teamPlan.starterFamily??[]).map(Number));
 const stuck=p=>starter.has(Number(p.species))||MAIL(p.heldItem);
 const ready=p=>team.has(p)&&p.level>=Number(sweepLevel)&&hasUsableAttackingPp(p,mechanics)&&!obedienceRisk(p,o);
 const order=(left,right)=>Number(right.level)-Number(left.level)||Number(party.includes(right))-Number(party.includes(left))||
  Number(left.personality)-Number(right.personality);
 const capable=all.filter(ready).sort(order);
 // The driver (no filler) trains the battle team itself: one member per
 // permanent family, the strongest (party first), never a boxed duplicate.
 const core=includeFiller?team:new Set(teamPlan.permanentFamilies.map(f=>all.filter(p=>team.has(p)&&f.map(Number).includes(Number(p.species))).sort(order)[0]).filter(Boolean));
 if(capable.length<5)return inactive('fewer-than-five-sweep-level-battlers');
 const blocked=new Set([...protectedFingerprints,...(state?.completed??[])]);
 const eligible=p=>p.level<100&&p.shiny===false&&!blocked.has(encounterFingerprint(p))&&!blocked.has(JSON.stringify([p.personality,p.otId]))&&
  hasUsableAttackingPp(p,mechanics)&&!MAIL(p.heldItem)&&Number(p.heldItem)!==EVERSTONE;
 const partyStuck=party.filter(stuck);
 const choose=(trainee,reason,target)=>{
  // Every party member that the roster cannot deposit must battle or train.
  const forced=partyStuck.filter(p=>!same(p,trainee));
  if(forced.some(p=>!ready(p)))return null;
  const battlers=[...forced,...capable.filter(p=>!same(p,trainee)&&!forced.some(q=>same(q,p)))].slice(0,5);
  if(battlers.length<5||!partyStuck.every(p=>same(p,trainee)||battlers.some(q=>same(q,p))))return null;
  return {active:true,reason,battlers:battlers.map(identity),trainee:{...identity(trainee),reason,...target},
   starterFamily:[...(teamPlan.starterFamily??[])]};
 };
 const plans=[];
 // The current trainee finishes first, except a filler (c) trainee: it yields
 // to (a) and (b) candidates and trains on only when none can be composed.
 const current=state?.trainee?all.find(p=>same(p,state.trainee)):null;
 const resume=current&&eligible(current)&&!leagueTraineeReached(current,state.trainee)?()=>choose(current,state.trainee.reason,
  {targetLevel:state.trainee.targetLevel,targetSpecies:state.trainee.targetSpecies,fromSpecies:state.trainee.fromSpecies}):null;
 const filler=!['dex-level-evolution','team-below-max-level'].includes(state?.trainee?.reason);
 if(resume&&!filler)plans.push(resume);
 // (a) A Dex level-up evolution, every owned option in rank order. Evolution
 // items stay out of this passive plan, so the selector sees an empty item
 // pocket and no supply. Friendship-only (no level) and Shedinja (a full party
 // loses the extra Pokemon) rules never train here.
 for(const {pokemon,rule} of ownedDexEvolutionOptions({trainer:{...t,party,storage:{...t.storage,pokemon:stored},bag:{...t.bag,items:[],berries:[],keyItems:t.bag?.keyItems??[]}},
  protectedFingerprints:[...blocked],scope:'national'}))
  if(rule.trigger==='level-up'&&!rule.item&&Number(rule.level)>0&&!rule.extraPartySlot&&eligible(pokemon))plans.push(()=>choose(pokemon,'dex-level-evolution',
   {targetLevel:Number(rule.level),targetSpecies:rule.speciesId,fromSpecies:nationalSpeciesId(pokemon.species)}));
 // (b) The team's own members still short of level 100, lowest first.
 for(const p of all.filter(p=>core.has(p)&&eligible(p)).sort((a,b)=>a.level-b.level||order(a,b)))
  plans.push(()=>choose(p,'team-below-max-level',{targetLevel:100}));
 if(resume&&filler)plans.push(resume);
 // (c) The lowest-level useful party member (League rounds that run anyway).
 if(includeFiller)for(const p of party.filter(p=>!team.has(p)&&eligible(p)).sort((a,b)=>a.level-b.level||order(a,b)))
  plans.push(()=>choose(p,'lowest-level-party-member',{targetLevel:100}));
 for(const plan of plans){const selected=plan();if(selected)return withExpShare(selected,o,party,stored);}
 return inactive('no-eligible-trainee');
}

function withExpShare(plan,o,party,stored){
 const bag=Object.values(o.playerMemory?.trainer?.bag??{}).flat().some(i=>Number(i?.itemId)===LEAGUE_EXP_SHARE_ITEM&&Number(i.quantity)>0);
 const holder=[...party,...stored].find(p=>Number(p.heldItem)===LEAGUE_EXP_SHARE_ITEM);
 if(!bag&&!holder)return {active:false,reason:'no-exp-share'};
 return plan;
}

export function leagueTraineeReached(pokemon,trainee){
 if(!pokemon||!trainee)return false;
 if(Number(pokemon.level)>=100)return true;
 if(trainee.targetSpecies!=null&&nationalSpeciesId(pokemon.species)!==Number(trainee.fromSpecies))return true;
 return trainee.targetSpecies==null&&Number(trainee.targetLevel)>0&&Number(pokemon.level)>=Number(trainee.targetLevel);
}

// The next composition step for an active plan at a Pokemon Center, or null
// once five battlers and the Exp. Share-holding trainee (not leading) are set.
// Every step is derived from the observed party, PC and bag.
export function leagueExpShareStep({o,plan,mechanics,center}){
 const {party,stored}=members(o,mechanics),t=o.playerMemory.trainer;
 const find=who=>[...party,...stored].find(p=>same(p,who));
 const trainee=find(plan.trainee),battlers=plan.battlers.map(find);
 if(!trainee||battlers.some(p=>!p))return {kind:'stop-for-review',reason:'The League Exp. Share roster changed before it was assembled.'};
 const fp=encounterFingerprint,inParty=p=>party.some(q=>same(q,p));
 const roster=required=>({kind:'party-roster',map:center,minimumPartySize:required.length,maximumPartySize:required.length,requiredFingerprints:required.map(fp)});
 const bag=Object.values(t.bag??{}).flat().some(i=>Number(i?.itemId)===LEAGUE_EXP_SHARE_ITEM&&Number(i.quantity)>0);
 const partyHolder=party.find(p=>Number(p.heldItem)===LEAGUE_EXP_SHARE_ITEM);
 const storedHolder=stored.find(p=>Number(p.heldItem)===LEAGUE_EXP_SHARE_ITEM);
 if(!bag&&!partyHolder&&storedHolder&&!same(storedHolder,trainee)){
  // Bring the boxed holder in for one visit; one non-starter member leaves.
  const starter=new Set((plan.starterFamily??[]).map(Number));
  const leaving=party.find(p=>!same(p,trainee)&&!starter.has(Number(p.species))&&!MAIL(p.heldItem))??null;
  if(!leaving)return {kind:'stop-for-review',reason:'No party member can make room for the boxed Exp. Share holder.'};
  return roster([...party.filter(p=>!same(p,leaving)),storedHolder]);
 }
 if(partyHolder&&!same(partyHolder,trainee))return {kind:'take-held-item',fingerprint:fp(partyHolder),map:center,itemId:LEAGUE_EXP_SHARE_ITEM};
 const required=[...battlers,trainee];
 if(party.length!==6||!required.every(inParty))return roster(required);
 const member=party.find(p=>same(p,trainee));
 if(Number(member.heldItem)!==LEAGUE_EXP_SHARE_ITEM&&Number(member.heldItem)>0)return {kind:'take-held-item',fingerprint:fp(member),map:center,itemId:Number(member.heldItem)};
 if(Number(member.heldItem)!==LEAGUE_EXP_SHARE_ITEM)return bag?{kind:'give-held-item',fingerprint:fp(member),map:center,itemId:LEAGUE_EXP_SHARE_ITEM}
  :{kind:'stop-for-review',reason:'The League Exp. Share was not found for its trainee.'};
 const lead=[...party].sort((a,b)=>Number(a.slot)-Number(b.slot))[0];
 if(same(lead,trainee)){
  const fighter=party.filter(p=>!same(p,trainee)).sort((a,b)=>Number(b.level)-Number(a.level)||Number(a.slot)-Number(b.slot))[0];
  return {kind:'lead-party-member',fingerprint:fp(fighter),map:center};
 }
 return null;
}

// Round bookkeeping: strikes and holds. A round opens in Lorelei's room with
// the composed trainee ({leagueEntries, traineeExperience, money, faints,
// conditions}) and is judged at the first readable frame outside the rooms
// (never in the Hall of Fame); judging closes it and clears s.active. A hold
// is written into s.disabled ({reason, class:'hold', conditions, heldAt}):
// later rounds keep the full team, and only an owner resume in Bot settings
// lifts it. The trainee stays protected until its round is judged, a hold
// included (owner decision, Sept 26). A record without heldAt comes from an
// earlier engine (firstSeenAt stands in for its time).
// - Strike (training continues): one fainted battler in a won round (owner
//   decision, Sept 26). The faint stays in the round's history entry.
// - Hold at once: two or more faints in the round (a battler fainting in two rooms is two), trainee
//   damage, the trainee missing from a readable party, a blocked intermission
//   (the League recovery stops the bot).
// - Hold at the judgement: a round without a new Hall of Fame entry, a round
//   with a faint when another of the last five judged trainee rounds had one
//   too, or a trainee below 100 that gained no experience.
// Unreadable reads defer the verdict; nothing is inferred from them.
const HISTORY=50,STRIKE_WINDOW=5,STRIKES=2;
const LEAGUE_MAP=/^MAP_POKEMON_LEAGUE_/;
const iso=now=>new Date(Number.isFinite(Number(now))?Number(now):Date.now()).toISOString();
export const recordLeagueExpShareHistory=(s,entry)=>{s.history=[...(s.history??[]),entry].slice(-HISTORY);};
const remember=recordLeagueExpShareHistory;
const add=(list,item)=>{if(!list.includes(item))list.push(item);};
// Writes a hold (never over an earlier one) with its history entry.
export function holdLeagueExpShare(s,reason,{o,conditions=[],now=Date.now()}={}){
 if(s.disabled)return;
 const entries=Number(o?.playerMemory?.gameStats?.leagueEntries);
 s.disabled={reason,class:'hold',conditions:[...new Set(conditions)],leagueEntries:Number.isInteger(entries)?entries:null,frame:o?.frame??null,map:o?.playerMemory?.map?.id??null,heldAt:iso(now)};
 remember(s,{kind:'hold',...structuredClone(s.disabled)});
}
// Distinct fainted battlers in a round (a battler fainting in two rooms is one).
const faintedBattlers=faints=>new Set((faints??[]).map(f=>`${Number(f.personality)}:${Number(f.otId)}`)).size;
const roundHold=r=>['trainee-left-party','trainee-entered-battle'].find(c=>r.conditions.includes(c))??
 r.conditions.find(c=>c.startsWith('league-recovery:'))??((r.faints?.length??0)>=2?'battler-fainted:multiple':null);
// A faint in STRIKES of the last STRIKE_WINDOW judged trainee rounds (this one
// included). Only a round with a faint of its own is judged by it: after a
// resume, a clean round never holds on the strikes that caused the hold.
const repeatedStrikes=s=>(s.history??[]).filter(h=>h.kind==='round').slice(-STRIKE_WINDOW).filter(h=>faintedBattlers(h.faints)>0).length>=STRIKES;
export function observeLeagueExpShareRound({o,state,inLeague,room,blockedReason=null,mechanics=null,now=Date.now()}){
 const s=state.leagueExpShare??={},m=o.playerMemory;
 // The Hall of Fame walk-in and scene precede the entry counter; judge the round later.
 if(m?.map?.id==='MAP_POKEMON_LEAGUE_HALL_OF_FAME'||o.emulator?.mode==='hall-of-fame')return s;
 const entries=Number(m?.gameStats?.leagueEntries),t=m?.trainer,valid=t?.partyValidity==='valid',party=valid?t.party??[]:[];
 const hold=(reason,conditions)=>holdLeagueExpShare(s,reason,{o,conditions,now});
 const r=s.round;
 if(r){r.faints??=[];r.conditions??=[];}
 // Judge an open round outside the rooms, or a stale one (no active trainee
 // round) wherever it is found, at the first readable frame.
 if(r&&(!inLeague||!s.active)){
  if(!Number.isInteger(entries)||!valid)return s;
  const found=[...party,...(t.storage?.validity==='valid'?t.storage.pokemon??[]:[])].find(p=>same(p,s.trainee))??null;
  const level=found?Number.isInteger(found.level)?found.level:mechanics?qmmLevel(found,mechanics):null:null;
  const gain=Number.isFinite(Number(found?.experience))&&Number.isFinite(r.traineeExperience)?Number(found.experience)-r.traineeExperience:null;
  const money=Number(t.money),won=Number.isInteger(r.leagueEntries)&&entries>r.leagueEntries;
  const conditions=[...r.conditions];
  remember(s,{kind:'round',baseline:r.leagueEntries??null,leagueEntries:entries,won,faints:structuredClone(r.faints),conditions,expGain:gain,
   moneyDelta:Number.isFinite(money)&&Number.isFinite(r.money)?money-r.money:null,
   trainee:{personality:s.trainee?.personality??null,otId:s.trainee?.otId??null,species:found?.species??s.trainee?.species??null,level},frame:o.frame??null,at:iso(now)});
  if(!Number.isInteger(r.leagueEntries))hold('round-baseline-unknown',conditions);
  else if(!won){if(s.disabled?.class==='hold')add(s.disabled.conditions,'round-not-won');hold('round-not-won',conditions);}
  const reason=roundHold(r)??(faintedBattlers(r.faints)>0&&repeatedStrikes(s)?'battler-fainted:repeat':null)??(level!==null&&level<100&&gain===0?'no-experience-gain':null);
  if(reason)hold(reason,conditions);
  delete s.round;s.active=false;
  return s;
 }
 if(!inLeague||!s.trainee||!s.active)return s;
 const flags=m?.storyState?.flagIds??{};
 if(!r&&room===0)s.round={leagueEntries:Number.isInteger(entries)?entries:null,traineeExperience:null,money:null,faints:[],conditions:[]};
 const round=s.round;if(!round)return s;
 if(round.leagueEntries==null&&Number.isInteger(entries))round.leagueEntries=entries;
 if(blockedReason)add(round.conditions,`league-recovery:${blockedReason}`);
 if(valid){
  const trainee=party.find(p=>same(p,s.trainee));
  // The baselines are read before Lorelei is beaten (no experience or payout yet).
  if(room===0&&flags[1208]!==true&&trainee&&round.traineeExperience==null&&Number.isFinite(Number(trainee.experience))){
   round.traineeExperience=Number(trainee.experience);
   if(Number.isFinite(Number(t.money)))round.money=Number(t.money);
  }
  for(const p of party)if(!same(p,s.trainee)&&Number(p.maxHp)>0&&Number(p.hp)===0&&!round.faints.some(f=>same(f,p)&&f.room===room))
   round.faints.push({...identity(p),room,frame:o.frame??null});
  if(round.faints.length)add(round.conditions,'battler-fainted');
  if(!trainee)add(round.conditions,'trainee-left-party');
  else if(Number(trainee.hp)<Number(trainee.maxHp))add(round.conditions,'trainee-entered-battle');
 }
 const reason=roundHold(round);
 if(reason)hold(reason,round.conditions);
 return s;
}

// A hold recorded by an earlier engine has no heldAt: the first time this engine
// sees it (controller start, or a release check) stands in for its time, so an
// older resume stamp never lifts it.
export function noteLeagueExpShareHold(s,now=Date.now()){const h=s?.disabled;if(h&&h.heldAt==null&&h.firstSeenAt==null)h.firstSeenAt=iso(now);}
// The owner's Bot settings resume ({enabled, resumedAt}, stamped when the
// setting is turned back on) covers a hold made (or first seen) before it.
export const leagueResumeCovers=(h,owner)=>Boolean(h)&&owner?.enabled!==false&&Date.parse(owner?.resumedAt??'')>Date.parse(h.heldAt??h.firstSeenAt??'');
// A covered hold is released only outside the League with no round open. Round
// history stays.
export function releaseLeagueExpShareHold(s,{owner=null,o,now=Date.now()}={}){
 const h=s?.disabled,map=o?.playerMemory?.map?.id;
 noteLeagueExpShareHold(s,now);
 if(!h||s.round||typeof map!=='string'||LEAGUE_MAP.test(map)||!leagueResumeCovers(h,owner))return false;
 remember(s,{kind:'resumed',hold:structuredClone(h),resumedAt:owner.resumedAt,frame:o?.frame??null,at:iso(now)});
 delete s.disabled;
 return true;
}

// The Bot setting as the owner sees it: on unless turned off, and the resume stamp
// the host writes when it goes from off to on (pokemon_bot_settings.py). Both sit
// beside the preferences, which an older host reads alone. No file, or an
// unreadable one, is on without a resume.
export function leagueTrainingSetting(file){
 const at=file?.leagueExpShareResumedAt;
 return {enabled:file?.leagueExpShareTraining!==false,resumedAt:typeof at==='string'&&Number.isFinite(Date.parse(at))?at:null};
}
export const validLeagueTrainingOwner=v=>v===null||typeof v?.enabled==='boolean'&&(v.resumedAt===null||typeof v.resumedAt==='string');

const HOLD_TEXT={'battler-fainted':'a battler fainted','battler-fainted:multiple':'two or more battlers fainted in one League round',
 'battler-fainted:repeat':'battlers fainted in two of the last five League rounds','trainee-entered-battle':'the trainee entered a battle',
 'trainee-left-party':'the trainee left the party','round-not-won':'a League round ended without a new Hall of Fame entry',
 'round-baseline-unknown':'a League round began without a readable Hall of Fame count','no-experience-gain':'a League round gave the trainee no experience'};
// The checklist reason for a hold (owner: the Bot setting the controller last read).
// The web and Mac Bot settings both call the setting "League training".
export function leagueTrainingPaused(h,owner=null){
 if(leagueResumeCovers(h,owner))return 'Resume requested in Bot settings. It applies at the next free moment outside the League.';
 const reason=String(h?.reason??'unknown'),what=HOLD_TEXT[reason]??(reason.startsWith('league-recovery:')?`the League recovery stopped (${reason.slice(16)})`:
  reason.startsWith('composition:')?`the League team could not be composed (${reason.slice(12).replace(/\.$/,'')})`:`a League hold (${reason})`);
 return `Paused after ${what}${Number.isInteger(h?.leagueEntries)?` at Hall of Fame entry ${h.leagueEntries}`:''}. To resume, turn League training off in Bot settings and save, then turn it on and save again.`;
}

// The league-training checklist demand, cached in s.demand for the
// mechanics-free checklist. The controller refreshes it at stable field
// decisions outside the League: an owner resume applies first (a held entry is
// never selected, so it never resolves), then the driver plan (no new filler;
// a trainee at its target counts as completed) is recomputed only when the
// party, PC, Dex, Bag, state, owner option or Hall of Fame count change.
export function refreshLeagueTraining(workflows,{o,mechanics,teamPlan,protectedFingerprints=[],owner=null,now=Date.now()}={}){
 const s=workflows.leagueExpShare??={},m=o?.playerMemory,t=m?.trainer,entries=m?.gameStats?.leagueEntries,frame=o?.frame??null;
 releaseLeagueExpShareHold(s,{owner,o,now});
 if(t?.partyValidity!=='valid'||t.storage?.validity!=='valid')return s.demand={known:false,reason:'party-or-storage-unknown',frame};
 if(!Number.isInteger(entries))return s.demand={known:false,reason:'league-entries-unknown',frame};
 const {party,stored}=members(o,mechanics),all=[...party,...stored],flags=m.storyState?.flagIds??{};
 const shares=Object.values(t.bag??{}).flat().filter(i=>Number(i?.itemId)===LEAGUE_EXP_SHARE_ITEM).reduce((n,i)=>n+(Number(i.quantity)||0),0);
 const signature=createHash('sha256').update(JSON.stringify([all.map(p=>[p.personality,p.otId,p.otName,p.species,p.level,p.heldItem,p.moves,p.pp,p.shiny,party.includes(p)]),
  t.otId,t.playerName,t.pokedex?.ownedSpecies?.length??null,shares,[s.disabled,s.round,s.trainee,s.completed,s.lent],owner,entries,teamPlan,protectedFingerprints,
  [2081,2083,2085,2087].map(id=>flags[id])])).digest('hex');
 if(s.demand?.known&&s.demand.signature===signature)return s.demand;
 const state={...s},current=s.trainee?all.find(p=>same(p,s.trainee)):null;
 if(current&&leagueTraineeReached(current,s.trainee)){state.completed=[...new Set([...(s.completed??[]),JSON.stringify([s.trainee.personality,s.trainee.otId])])];delete state.trainee;}
 const plan=leagueExpSharePlan({o,mechanics,teamPlan,state,protectedFingerprints,sweepLevel:leagueSweepLevel(leagueRematchLevels(mechanics)),owner,includeFiller:false});
 const who=plan.active?all.find(p=>same(p,plan.trainee)):null;
 return s.demand={known:true,signature,frame,owner:{enabled:owner?.enabled!==false},plan:{active:plan.active,reason:plan.reason,trainee:plan.trainee??null},
  ...(who?{label:`${speciesName(mechanics,who.species)} Lv. ${who.level} → Lv. ${plan.trainee.targetLevel}`}:{})};
}

// The trainee lends its own held item slot to the Exp. Share. The composition
// records what it held (ownItem, 0 for none) when it takes that item or gives
// the Exp. Share; a trainee found holding the Exp. Share from an earlier
// composition is recorded with an unknown own item (null).
export function recordLeagueExpShareLend(s,{o,plan,step,mechanics}){
 if(!plan?.active)return;
 const trainee=members(o,mechanics).party.find(p=>same(p,plan.trainee));
 if(!trainee)return;
 if(step&&step.fingerprint===encounterFingerprint(trainee)){
  if(step.kind==='take-held-item'&&Number(step.itemId)!==LEAGUE_EXP_SHARE_ITEM)s.lent={...identity(trainee),ownItem:Number(step.itemId)};
  else if(step.kind==='give-held-item'&&Number(step.itemId)===LEAGUE_EXP_SHARE_ITEM&&!same(s.lent,trainee))s.lent={...identity(trainee),ownItem:0};
 }else if(!step&&Number(trainee.heldItem)===LEAGUE_EXP_SHARE_ITEM&&!same(s.lent,trainee))s.lent={...identity(trainee),ownItem:null};
}

// When the trainee rotates out or the passive setup ends, its item slot is
// given back before anything else is composed: the Exp. Share returns to the
// Bag (where the general held-item policy places it, as other borrowed Exp.
// Shares return) and the member gets its own recorded item from the Bag. The
// same take/give (and boxed-member roster) targets as the composition are
// used. Returns {shield, step} while a step remains, otherwise null and the
// lend is closed in s.restored (an own item no longer in the Bag is recorded,
// never searched for, and the League continues).
export function leagueExpShareRestore({o,state:s,plan,mechanics,center,starterFamily=[]}){
 const lent=s.lent;if(!lent||plan?.active&&same(plan.trainee,lent))return null;
 const t=o.playerMemory?.trainer;
 if(t?.partyValidity!=='valid'||t.storage?.validity!=='valid')return s.restoring??null;
 const {party,stored}=members(o,mechanics),bag=Object.values(t.bag??{}).flat();
 const finish=(extra={})=>{s.restored={personality:lent.personality,otId:lent.otId,species:lent.species,itemId:lent.ownItem??null,frame:o.frame??null,...extra};delete s.lent;return null;};
 const p=[...party,...stored].find(q=>same(q,lent));
 if(!p)return finish({pokemonMissing:true});
 const held=Number(p.heldItem)||0,own=Number(lent.ownItem)||0,fp=encounterFingerprint(p),inParty=party.some(q=>same(q,p));
 const shield={...identity(p),reason:'return-lent-item-slot',...(own?{reservedItemId:own}:{})};
 const owned=itemId=>bag.some(i=>Number(i?.itemId)===itemId&&Number(i.quantity)>0);
 let step=null;
 if(held===LEAGUE_EXP_SHARE_ITEM)step={kind:'take-held-item',fingerprint:fp,map:center,itemId:LEAGUE_EXP_SHARE_ITEM};
 else if(held===0&&own>0){
  if(!owned(own))return finish({missing:true});
  step={kind:'give-held-item',fingerprint:fp,map:center,itemId:own};
 }else return finish(held===own?{}:{replacedBy:held});
 if(!inParty){
  // A boxed member visits the party for its items; one non-starter member makes room.
  const starter=new Set(starterFamily.map(Number));
  const leaving=party.length<6?null:party.find(q=>!starter.has(Number(q.species))&&!MAIL(q.heldItem))??null;
  if(party.length>=6&&!leaving)return finish({unreachable:true});
  const required=[...party.filter(q=>q!==leaving),p];
  step={kind:'party-roster',map:center,minimumPartySize:required.length,maximumPartySize:required.length,requiredFingerprints:required.map(encounterFingerprint)};
 }
 return {shield,step};
}
