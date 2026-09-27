import {createHash} from 'node:crypto';
// Supervise observed results, including executable advice that has no effect.
// Keep it in the owner's checkpoint so re-instantiating a planner is no reset.
export function observePostgameNavigation(state,o,objective,decision,now){
 const recommendation=decision?.winner?.recommendation??decision?.recommendation;
 const base={objective:objective?.id,target:objective?.target};
 if(o.phase!=='stable'||o.emulator?.mode!=='overworld'||o.emulator.inBattle||Object.values(o.playerMemory?.ui??{}).some(Boolean)){
  state.lastAt=now;delete state.surface;return {...base,status:'temporarily-blocked',reason:'Wait for the current game interaction to finish.'};
 }
 const key=JSON.stringify([objective?.id,objective?.target,o.playerMemory?.map?.id,o.playerMemory?.position]);
 if(state.key!==key)Object.assign(state,{key,idleMs:0,attempts:0,lastAt:now,surface:null});
 const m=o.playerMemory;
 const surface=JSON.stringify([m?.avatar?.facing,
  Object.entries(m?.storyState?.flagIds??{}).filter(([id])=>Number(id)>=32),
  Object.entries(m?.storyState?.variableIds??{}).filter(([id])=>Number(id)>=0x4030&&Number(id)<0x8000),
  m?.trainer?.bag,m?.trainer?.money,m?.gameStats?.savedGame]);
 if(state.surface!==surface){state.surface=surface;state.idleMs=0;state.attempts=0;state.lastAt=now;}
 const executable=recommendation?.kind!=='wait-for-supported-objective'&&decision?.reason!=='no-advice';
 state.idleMs+=Math.max(0,Math.min(5000,now-(state.lastAt??now)));state.lastAt=now;
 const reason=executable?'The attempted field action produced no observed progress for the selected objective.':recommendation?.navigation?.reason??'No executable route or interaction for the selected objective.';
 if(state.idleMs>=30000)return {...base,status:'failed',reason,attempts:state.attempts};
 if(state.attempts<2&&state.idleMs>=(state.attempts+1)*10000){state.attempts++;return {...base,status:'retry',reason,attempts:state.attempts};}
 if(executable)return {...base,status:'action'};
 return {...base,status:'waiting',reason,attempts:state.attempts,remainingMs:30000-state.idleMs};
}
// Watchdogs saved before their story ids were recorded (build 116 and earlier)
// covered every id this engine watches except VAR_NATIONAL_DEX, which
// navigation reads for the dug-out Dunsparce Tunnel.
const LEGACY_UNWATCHED_VARIABLES=new Set([0x404e]);
// Count active decision time and cartridge progress, not frames, steps or text.
// A retained owner spans its travel, menus and preparation sub-objectives.
// `native` is the owner's own bounded cartridge progress that the fields below
// cannot show (the Day Care's pending-Egg rolls); only that owner passes it.
export function observePostgameProgress(state,o,owner,now,purpose=null,native=null){
 if(!owner)return false;
 if(o.phase!=='stable'){
  if(state.owner!==owner){state.owner=owner;state.seen=[];state.storySeen=[];state.idleMs=0;state.lastAt=now;state.reason=null;}
  state.verifiedStoryProgress=false;
  const delta=state.lastAt==null?0:Math.max(0,Math.min(5000,now-state.lastAt));state.lastAt=now;
  if(state.owner===owner)state.idleMs=(state.idleMs??0)+delta;
  return (state.idleMs??0)>=300000;
 }
 const m=o.playerMemory,t=m?.trainer;
 const storyEvidence=[
  Object.entries(m?.storyState?.flagIds??{}).filter(([id])=>Number(id)>=32),
  Object.entries(m?.storyState?.variableIds??{}).filter(([id])=>Number(id)>=0x4030&&Number(id)<0x8000),
 ];
 const evidenceOf=story=>{
  const evidence=purpose==='currency'?[owner,t?.money,m?.postgameEvidence?.acquisition?.coins,t?.bag,
   [...(t?.pokedex?.ownedSpecies??[])].sort((a,b)=>a-b)]:[owner,
   ...story,
   t?.pokedex?.ownedSpecies,
   [t?.party,t?.storage?.pokemon].map(group=>group?.map(p=>[p.personality,p.otId,p.species,...(['currency','maintenance'].includes(purpose)?[]:[p.level,p.experience,p.friendship]),p.heldItem,p.isEgg])),
   // A verified save protects a transaction, but repeated saves are not new
   // objective progress. Its owner still verifies and drains any pending save.
   m?.gameStats?.leagueEntries,m?.gameStats?.eggsHatched,
   t?.bag,t?.money,m?.postgameEvidence?.acquisition?.coins,m?.postgameEvidence?.fameChecker,m?.postgameEvidence?.trainerTower,
  ];
  if(native!=null)evidence.push(native);
  return evidence;
 };
 const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const signature=digest(evidenceOf(storyEvidence));
 const delta=state.lastAt==null?0:Math.max(0,Math.min(5000,now-state.lastAt));
 state.lastAt=now;
 if(state.owner!==owner){state.owner=owner;state.seen=[];state.storySeen=[];state.idleMs=0;state.reason=null;}
 // An engine update can watch story values this owner's evidence never
 // covered. If the evidence limited to the ids it did cover was already seen,
 // the new values are a baseline, neither progress nor story progress.
 const storyIds=storyEvidence.map(entries=>entries.map(([id])=>Number(id)));
 const covered=(state.storyIds??(state.seen.length?[storyIds[0],storyIds[1].filter(id=>!LEGACY_UNWATCHED_VARIABLES.has(id))]:null))?.map(ids=>new Set(ids));
 const limited=covered&&storyIds.some((ids,i)=>ids.some(id=>!covered[i].has(id)))?storyEvidence.map((entries,i)=>entries.filter(([id])=>covered[i].has(Number(id)))):null;
 state.storyIds=storyIds;
 const storySignature=digest(storyEvidence);
 const storySeen=Array.isArray(state.storySeen)?state.storySeen:[];
 const baseline=Boolean(limited)&&state.seen.includes(digest(evidenceOf(limited)));
 const storyBaseline=Boolean(limited)&&storySeen.includes(digest(limited));
 state.verifiedStoryProgress=purpose!=='currency'&&storySeen.length>0&&!storySeen.includes(storySignature)&&!storyBaseline;
 if(!storySeen.includes(storySignature))state.storySeen=[...storySeen,storySignature].slice(-128);
 if(!state.seen.includes(signature)){
  state.seen=[...state.seen,signature].slice(-128);
  if(baseline)state.idleMs+=delta;else{state.idleMs=0;state.reason=null;state.lastProgressAt=now;}
 }else state.idleMs+=delta;
 return state.idleMs>=300000;
}

// A timeout requests a safe boundary; the existing transaction/player still
// owns inputs until it reaches that boundary. Replanning cannot renew this lease.
// A boundary's `cause` names an owner's exhausted native wait (Day Care Egg rolls).
export function observePostgameBoundary(state,o,owner,reason,now){
 state.owner??=owner;state.reason??=reason;state.elapsedMs??=0;
 state.elapsedMs+=Math.max(0,Math.min(5000,now-(state.lastAt??now)));state.lastAt=now;
 const interaction=o.emulator?.inBattle?'battle':o.phase!=='stable'?'transition':
  Object.entries(o.playerMemory?.ui??{}).find(([,value])=>value)?.[0]??'owned transaction';
 const remainingMs=Math.max(0,120000-state.elapsedMs);
 if(state.owner!==owner||!remainingMs)return {status:'failed',reason:`Recovery could not finish the ${interaction} within its 120-second active deadline; the owned task and checkpoint are retained.${state.cause?' '+state.cause:''}`,remainingMs:0};
 return {status:'draining',reason:`Finishing the current ${interaction} before saving or deferring: ${state.reason}`,remainingMs};
}
